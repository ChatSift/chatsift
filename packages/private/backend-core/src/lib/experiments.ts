import { createHash } from 'node:crypto';
import { setInterval } from 'node:timers';
import type { ExperimentOverrides, Experiments } from '@chatsift/db';
import { getContext } from './context.js';

/**
 * Number of buckets a guild can hash into. `range_start`/`range_end` are expressed in these units, so a
 * range of `[0, 100)` is 1% of guilds and `[0, 10000)` is all of them.
 *
 * Basis points rather than percent because the first consumer is AutoModerator
 * (docs/roadmap/11-automoderator-port.md), where a misfiring filter bans people: on a deployment of a few
 * thousand guilds, one percent is already tens of guilds, which is too coarse a smallest-possible step for
 * the first widening past the test guild.
 */
const BUCKET_COUNT = 10_000;

const REFRESH_INTERVAL_MS = 60_000;

interface ExperimentRange {
	readonly rangeEnd: number;
	readonly rangeStart: number;
}

let ranges = new Map<string, ExperimentRange>();
let overrides = new Set<string>();
let refreshTimer: NodeJS.Timeout | null = null;

const overrideKey = (name: string, guildId: string): string => `${name}:${guildId}`;

/**
 * Which bucket a guild falls in for one experiment.
 *
 * Salted with the experiment's own name so each experiment selects a different slice -- hashing the guild id
 * alone would make the same guilds the guinea pigs for every rollout, which is the failure mode that makes
 * staged rollouts stop being informative. SHA-256 rather than a cheap string hash because the result has to
 * be identical across processes, replicas and restarts: a guild that flips in and out of an experiment as
 * the bot bounces is worse than no gating at all.
 */
export function experimentBucket(name: string, guildId: string): number {
	const digest = createHash('sha256').update(`${name}:${guildId}`).digest();
	return digest.readUInt32BE(0) % BUCKET_COUNT;
}

async function fetchSnapshot(): Promise<{ overrides: Set<string>; ranges: Map<string, ExperimentRange> }> {
	const db = getContext().db;

	// Both tables read wholesale rather than queried per lookup: they're tiny by design (an experiment per
	// shipped feature, and a handful of hand-set overrides), and the read path they serve runs on every
	// gated decision -- see the module doc on `isExperimentEnabled`.
	const [experimentRows, overrideRows] = await Promise.all([
		db<Experiments[]>`SELECT name, range_start, range_end FROM experiments`,
		db<ExperimentOverrides[]>`SELECT guild_id, experiment_name FROM experiment_overrides`,
	]);

	return {
		ranges: new Map(
			experimentRows.map((row) => [row.name as string, { rangeStart: row.rangeStart, rangeEnd: row.rangeEnd }]),
		),
		overrides: new Set(overrideRows.map((row) => overrideKey(row.experimentName as string, row.guildId))),
	};
}

function applySnapshot(snapshot: { overrides: Set<string>; ranges: Map<string, ExperimentRange> }): void {
	ranges = snapshot.ranges;
	overrides = snapshot.overrides;
}

/**
 * Loads the experiment tables into an in-memory snapshot and starts a 60s background refresh, mirroring
 * `instances.ts`. Call once at boot, after `initContext()`.
 *
 * The refresh interval is also the kill-switch latency: an operator clearing an experiment's range to stop a
 * misbehaving feature waits up to a minute for every process to notice, with no deploy involved. That is the
 * whole point of gating features this way rather than behind env vars.
 */
export async function loadExperiments(): Promise<void> {
	applySnapshot(await fetchSnapshot());

	refreshTimer ??= setInterval(async () => {
		try {
			applySnapshot(await fetchSnapshot());
		} catch (error) {
			getContext().logger.error({ err: error }, 'Failed to refresh experiments');
		}
	}, REFRESH_INTERVAL_MS).unref();
}

/**
 * Whether `name` is on for `guildId`. Pure, synchronous and safe to call per decision -- it reads the
 * snapshot `loadExperiments` maintains, never the database.
 *
 * **An experiment with no row is off.** A feature shipped behind a gate is therefore inert until someone
 * deliberately creates it, which is the correct default for a product that takes moderation actions: the
 * failure mode of forgetting to create the row is "the feature does nothing", not "the feature is live
 * everywhere on deploy". `loadExperiments` never having been called reads the same way.
 */
export function isExperimentEnabled(name: string, guildId: string): boolean {
	if (overrides.has(overrideKey(name, guildId))) {
		return true;
	}

	const range = ranges.get(name);
	if (!range) {
		return false;
	}

	// Half-open, so `range_start == range_end` is empty and `[0, BUCKET_COUNT)` is everyone -- an operator
	// switching a feature off by collapsing the range doesn't have to reason about whether the boundary
	// guild is still in it.
	const bucket = experimentBucket(name, guildId);
	return bucket >= range.rangeStart && bucket < range.rangeEnd;
}
