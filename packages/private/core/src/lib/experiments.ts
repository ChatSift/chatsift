import murmurhash from 'murmurhash';

/**
 * Number of buckets a guild can hash into. `range_start`/`range_end` are expressed in these units, so a range
 * of `[0, 100)` is 1% of guilds and `[0, 10000)` is all of them.
 *
 * Carried over verbatim from this repo's pre-revive `ExperimentHandler` (deleted in `9d188f0c`), along with the
 * hash and the salt format below. That is the point: the three together decide which guilds a range selects, so
 * changing any of them silently re-rolls every experiment against a range someone already reasoned about.
 */
export const EXPERIMENT_BUCKET_COUNT = 10_000;

export interface ExperimentRange {
	readonly rangeEnd: number;
	readonly rangeStart: number;
}

/**
 * Why an experiment resolved the way it did, not just whether it's on -- the dashboard's guild checker exists
 * to answer "why is this guild in", and "bucket 8412, range [0, 10000)" is the only answer that lets an
 * operator predict what widening the range would do.
 */
export type ExperimentDecision =
	| { readonly bucket: number; readonly enabled: boolean; readonly range: ExperimentRange; readonly reason: 'range' }
	| { readonly enabled: false; readonly reason: 'unknown' }
	| { readonly enabled: true; readonly reason: 'override' };

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
	return murmurhash.v3(`${name}:${guildId}`) % EXPERIMENT_BUCKET_COUNT;
}

/**
 * The gating rule itself, given everything already looked up: the experiment's range (null when no row exists)
 * and whether this guild is overridden into it.
 *
 * Lives in `@chatsift/core` rather than next to the bot's snapshot because two callers have to agree on it --
 * `@chatsift/backend-core`'s `isExperimentEnabled`, which decides, and the dashboard's `/admin` guild checker,
 * which predicts. A checker running a second copy of this rule is a checker that can quietly start lying.
 */
export function resolveExperiment(
	name: string,
	guildId: string,
	range: ExperimentRange | null,
	hasOverride: boolean,
): ExperimentDecision {
	if (hasOverride) {
		return { enabled: true, reason: 'override' };
	}

	// An experiment with no row is off. A feature shipped behind a gate is therefore inert until someone
	// deliberately creates it, which is the correct default for a product that takes moderation actions.
	if (!range) {
		return { enabled: false, reason: 'unknown' };
	}

	// Half-open, so `rangeStart == rangeEnd` is empty and `[0, EXPERIMENT_BUCKET_COUNT)` is everyone -- an
	// operator switching a feature off by collapsing the range doesn't have to reason about whether the
	// boundary guild is still in it.
	const bucket = experimentBucket(name, guildId);
	return { enabled: bucket >= range.rangeStart && bucket < range.rangeEnd, bucket, range, reason: 'range' };
}
