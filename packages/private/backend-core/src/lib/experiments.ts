import { setInterval } from 'node:timers';
import type { ExperimentDecision, ExperimentRange } from '@chatsift/core';
import { resolveExperiment } from '@chatsift/core';
import type { ExperimentOverrides, Experiments } from '@chatsift/db';
import { getContext } from './context.js';

const REFRESH_INTERVAL_MS = 60_000;

let ranges = new Map<string, ExperimentRange>();
let overrides = new Set<string>();
/**
 * Just the experiment *names* that have at least one override, so `enabledExperimentsFor` can enumerate
 * candidates. Kept alongside `overrides` rather than derived from it: the lookup set is keyed by
 * `name:guildId` and splitting those back apart would depend on names never containing a `:`, which is true
 * today only because `upsertExperiment.ts` happens to validate the name that way.
 */
let overrideNames = new Set<string>();
/**
 * Unknown experiment names already warned about, so the warning below stays diagnostic rather than becoming
 * per-message log spam -- `isExperimentEnabled` is billed as safe to call per decision, and a gate that has
 * been shipped but not yet created is a *normal* state, not an incident. Cleared on every refresh so the
 * warning returns if the name is still unknown a minute later.
 */
let warnedUnknown = new Set<string>();
let refreshTimer: NodeJS.Timeout | null = null;

const overrideKey = (name: string, guildId: string): string => `${name}:${guildId}`;

interface ExperimentSnapshot {
	overrideNames: Set<string>;
	overrides: Set<string>;
	ranges: Map<string, ExperimentRange>;
}

async function fetchSnapshot(): Promise<ExperimentSnapshot> {
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
		overrideNames: new Set(overrideRows.map((row) => row.experimentName as string)),
	};
}

function applySnapshot(snapshot: ExperimentSnapshot): void {
	ranges = snapshot.ranges;
	overrides = snapshot.overrides;
	overrideNames = snapshot.overrideNames;
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
 * The gate decision itself, with no diagnostics attached. Split out from `isExperimentEnabled` so
 * `enabledExperimentsFor` can ask the same question without the unknown-experiment warning below: it asks about
 * every name in the snapshot for every guild, and a name that only exists as an override is unknown for every
 * guild *except* the one it targets -- which would turn that warning from "somebody checked a gate that doesn't
 * exist" into one line per uninvolved guild.
 *
 * This is only the snapshot lookup; the rule it feeds is `@chatsift/core`'s `resolveExperiment`, shared with
 * the dashboard's `/admin` guild checker so that a checker predicting a decision and this deciding it cannot
 * drift apart. It returns the whole decision rather than a boolean so `isExperimentEnabled` can tell "off
 * because out of range" from "off because no such gate" without re-deriving it.
 */
function evaluate(name: string, guildId: string): ExperimentDecision {
	return resolveExperiment(name, guildId, ranges.get(name) ?? null, overrides.has(overrideKey(name, guildId)));
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
	const decision = evaluate(name, guildId);

	// Warned rather than silently false, as the pre-revive handler did: the two ways to land here are a gate
	// nobody has created yet and a typo'd name, and only one of those is intentional. Once per name per
	// refresh, not once per call -- see `warnedUnknown`. An override for this exact guild counts as the gate
	// existing, so it never warns even with no range row backing it: `resolveExperiment` resolves that to
	// `override`, never `unknown`.
	if (decision.reason === 'unknown' && !warnedUnknown.has(name)) {
		warnedUnknown.add(name);
		getContext().logger.warn({ guildId, experimentName: name }, 'checked an unknown experiment');
	}

	return decision.enabled;
}

/**
 * Every experiment currently on for `guildId`, sorted. Same snapshot and same rules as
 * `isExperimentEnabled` -- this is that check run across every gate that exists, not a second source of truth.
 *
 * Exists so a client can be told what it may offer instead of discovering it by having a write refused: the
 * dashboard hides a gated control rather than rendering a button the API answers 403 to. The API is still the
 * enforcement point; this only decides what gets drawn.
 *
 * Names with neither a range row nor an override never appear, so a gate nobody has created reads as an empty
 * list. Goes through `evaluate` rather than `isExperimentEnabled` so enumerating candidates stays silent -- see
 * that function's comment; `me.ts` runs this once per guild in the user's list, so a warning here multiplies.
 */
export function enabledExperimentsFor(guildId: string): string[] {
	const candidates = new Set([...ranges.keys(), ...overrideNames]);
	return [...candidates]
		.filter((name) => evaluate(name, guildId).enabled)
		.sort((left, right) => left.localeCompare(right));
}
