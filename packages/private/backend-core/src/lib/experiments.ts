import { setInterval } from 'node:timers';
import type { ExperimentOverrides, Experiments } from '@chatsift/db';
import murmurhash from 'murmurhash';
import { getContext } from './context.js';

/**
 * Number of buckets a guild can hash into. `range_start`/`range_end` are expressed in these units, so a range
 * of `[0, 100)` is 1% of guilds and `[0, 10000)` is all of them.
 *
 * Carried over verbatim from this repo's pre-revive `ExperimentHandler` (deleted in `9d188f0c`), along with the
 * hash and the salt format below. That is the point: the three together decide which guilds a range selects, so
 * changing any of them silently re-rolls every experiment against a range someone already reasoned about.
 */
const BUCKET_COUNT = 10_000;

const REFRESH_INTERVAL_MS = 60_000;

interface ExperimentRange {
	readonly rangeEnd: number;
	readonly rangeStart: number;
}

let ranges = new Map<string, ExperimentRange>();
let overrides = new Set<string>();
/**
 * Unknown experiment names already warned about, so the warning below stays diagnostic rather than becoming
 * per-message log spam -- `isExperimentEnabled` is billed as safe to call per decision, and a gate that has
 * been shipped but not yet created is a *normal* state, not an incident. Cleared on every refresh so the
 * warning returns if the name is still unknown a minute later.
 */
let warnedUnknown = new Set<string>();
let refreshTimer: NodeJS.Timeout | null = null;

const overrideKey = (name: string, guildId: string): string => `${name}:${guildId}`;

/**
 * Which bucket a guild falls in for one experiment.
 *
 * MurmurHash3, matching the pre-revive implementation and Discord's own experiment bucketing. Not a security
 * boundary -- what it has to be is *stable*: identical across processes, replicas and restarts, or a guild
 * flips in and out of an experiment as the bot bounces, which is worse than no gating at all. Murmur is fast,
 * well-distributed and deterministic, which is the whole requirement.
 *
 * Salted with the experiment's own name so each experiment selects a different slice -- hashing the guild id
 * alone would make the same guilds the guinea pigs for every rollout, which is the failure mode that makes
 * staged rollouts stop being informative.
 */
export function experimentBucket(name: string, guildId: string): number {
	return murmurhash.v3(`${name}:${guildId}`) % BUCKET_COUNT;
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
	warnedUnknown = new Set();
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
		// Warned rather than silently false, as the pre-revive handler did: the two ways to land here are a gate
		// nobody has created yet and a typo'd name, and only one of those is intentional. Once per name per
		// refresh, not once per call -- see `warnedUnknown`.
		if (!warnedUnknown.has(name)) {
			warnedUnknown.add(name);
			getContext().logger.warn({ guildId, experimentName: name }, 'checked an unknown experiment');
		}

		return false;
	}

	// Half-open, so `range_start == range_end` is empty and `[0, BUCKET_COUNT)` is everyone -- an operator
	// switching a feature off by collapsing the range doesn't have to reason about whether the boundary
	// guild is still in it.
	const bucket = experimentBucket(name, guildId);
	return bucket >= range.rangeStart && bucket < range.rangeEnd;
}
