import { beforeEach, expect, test, vi } from 'vitest';
import { experimentBucket, isExperimentEnabled, loadExperiments } from '../experiments.js';

let experimentRows: { name: string; rangeEnd: number; rangeStart: number }[] = [];
let overrideRows: { experimentName: string; guildId: string }[] = [];
const error = vi.fn();
const warn = vi.fn();

// Same approach as `realtimeBroadcast.test.ts`: `experiments.ts` reaches for the db through `getContext()` at
// call time, so stubbing the context is enough. `db` is a tagged template, so the mock dispatches on the
// literal it was called with rather than on arguments.
vi.mock('../context.js', () => ({
	getContext: () => ({
		db: (strings: TemplateStringsArray) =>
			strings.join('').includes('experiment_overrides') ? overrideRows : experimentRows,
		logger: { error, warn },
	}),
}));

beforeEach(() => {
	experimentRows = [];
	overrideRows = [];
	error.mockReset();
	warn.mockReset();
});

test('a bucket is stable, in range, and salted by the experiment name', () => {
	const guildId = '1425493115053019319';

	expect(experimentBucket('cases', guildId)).toBe(experimentBucket('cases', guildId));

	for (const name of ['cases', 'filters', 'reports']) {
		const bucket = experimentBucket(name, guildId);
		expect(bucket).toBeGreaterThanOrEqual(0);
		expect(bucket).toBeLessThan(10_000);
	}

	// The whole point of the salt: one guild must not be the guinea pig for every rollout at once.
	expect(experimentBucket('cases', guildId)).not.toBe(experimentBucket('filters', guildId));
});

test('an experiment with no row is off, and says so', async () => {
	await loadExperiments();

	expect(isExperimentEnabled('never-created', '1425493115053019319')).toBe(false);
	// A typo'd gate name and a gate nobody created yet land here identically; only one is intentional.
	expect(warn).toHaveBeenCalledOnce();
});

test('a full range is on for everyone and a collapsed one is off for everyone', async () => {
	experimentRows = [
		{ name: 'everyone', rangeStart: 0, rangeEnd: 10_000 },
		{ name: 'nobody', rangeStart: 0, rangeEnd: 0 },
	];
	await loadExperiments();

	for (const guildId of ['1', '1425493115053019319', '1530909114736050316']) {
		expect(isExperimentEnabled('everyone', guildId)).toBe(true);
		expect(isExperimentEnabled('nobody', guildId)).toBe(false);
	}
});

test('an override switches a guild on regardless of its bucket', async () => {
	const guildId = '1425493115053019319';
	experimentRows = [{ name: 'nobody', rangeStart: 0, rangeEnd: 0 }];
	overrideRows = [{ experimentName: 'nobody', guildId }];
	await loadExperiments();

	expect(isExperimentEnabled('nobody', guildId)).toBe(true);
	expect(isExperimentEnabled('nobody', '1530909114736050316')).toBe(false);
});

test('an override is honoured even for an experiment with no row at all', async () => {
	// The override table has its own FK to `experiments`, so this can't happen through the API -- but the
	// snapshot is two independent reads, so it can be observed transiently mid-delete. Enabled is the safer
	// resolution of the two: an operator who deliberately named this guild gets what they asked for.
	const guildId = '1425493115053019319';
	overrideRows = [{ experimentName: 'orphaned', guildId }];
	await loadExperiments();

	expect(isExperimentEnabled('orphaned', guildId)).toBe(true);
});
