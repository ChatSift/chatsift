import { expect, test } from 'vitest';
import { EXPERIMENT_BUCKET_COUNT, experimentBucket, resolveExperiment } from '../experiments.js';

test('a bucket is stable, in range, and salted by the experiment name', () => {
	const guildId = '1425493115053019319';

	expect(experimentBucket('cases', guildId)).toBe(experimentBucket('cases', guildId));

	for (const name of ['cases', 'filters', 'reports']) {
		const bucket = experimentBucket(name, guildId);
		expect(bucket).toBeGreaterThanOrEqual(0);
		expect(bucket).toBeLessThan(EXPERIMENT_BUCKET_COUNT);
	}

	// The whole point of the salt: one guild must not be the guinea pig for every rollout at once.
	expect(experimentBucket('cases', guildId)).not.toBe(experimentBucket('filters', guildId));
});

test('an experiment with no range is off, and says which of the two reasons it is', () => {
	const decision = resolveExperiment('never-created', '1425493115053019319', null, false);

	expect(decision).toStrictEqual({ enabled: false, reason: 'unknown' });
});

test('an override wins over any range, including one it is nowhere near', () => {
	const guildId = '1425493115053019319';

	expect(resolveExperiment('nobody', guildId, { rangeStart: 0, rangeEnd: 0 }, true)).toStrictEqual({
		enabled: true,
		reason: 'override',
	});

	// The override table has its own FK to `experiments`, so this can't happen through the API -- but the
	// bot's snapshot is two independent reads, so it can be observed transiently mid-delete. Enabled is the
	// safer resolution: an operator who deliberately named this guild gets what they asked for.
	expect(resolveExperiment('orphaned', guildId, null, true)).toStrictEqual({ enabled: true, reason: 'override' });
});

test('a full range is on for everyone and a collapsed one is off for everyone', () => {
	for (const guildId of ['1', '1425493115053019319', '1530909114736050316']) {
		expect(
			resolveExperiment('everyone', guildId, { rangeStart: 0, rangeEnd: EXPERIMENT_BUCKET_COUNT }, false).enabled,
		).toBe(true);
		expect(resolveExperiment('nobody', guildId, { rangeStart: 0, rangeEnd: 0 }, false).enabled).toBe(false);
	}
});

test('a range decision carries the bucket and the range it was compared against', () => {
	const guildId = '1425493115053019319';
	const range = { rangeStart: 0, rangeEnd: EXPERIMENT_BUCKET_COUNT };
	const decision = resolveExperiment('everyone', guildId, range, false);

	// The checker renders these verbatim, so they have to be the numbers actually compared rather than a
	// recomputation the caller does itself.
	expect(decision).toStrictEqual({
		enabled: true,
		bucket: experimentBucket('everyone', guildId),
		range,
		reason: 'range',
	});
});

test('the range is half-open, so the boundary bucket is out', () => {
	const guildId = '1425493115053019319';
	const bucket = experimentBucket('boundary', guildId);

	expect(resolveExperiment('boundary', guildId, { rangeStart: bucket, rangeEnd: bucket + 1 }, false).enabled).toBe(
		true,
	);
	// `rangeEnd` itself is excluded -- collapsing a range to `[bucket, bucket)` must drop this guild.
	expect(resolveExperiment('boundary', guildId, { rangeStart: bucket, rangeEnd: bucket }, false).enabled).toBe(false);
});
