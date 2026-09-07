import { beforeEach, expect, test, vi } from 'vitest';
import { enabledExperimentsFor, experimentBucket, isExperimentEnabled, loadExperiments } from '../experiments.js';

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

test('an unknown experiment warns once per name, not once per call', async () => {
	// `isExperimentEnabled` is billed as safe to call per decision, so once a real caller lands on the
	// per-message path an uncreated gate would otherwise warn on every single message.
	await loadExperiments();

	for (let index = 0; index < 5; index++) {
		isExperimentEnabled('never-created', '1425493115053019319');
	}

	isExperimentEnabled('also-missing', '1425493115053019319');
	expect(warn).toHaveBeenCalledTimes(2);

	// A refresh clears the record, so a name that is *still* unknown a minute later says so again.
	await loadExperiments();
	isExperimentEnabled('never-created', '1425493115053019319');
	expect(warn).toHaveBeenCalledTimes(3);
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

test('enabledExperimentsFor lists exactly the gates on for that guild, sorted', async () => {
	const guildId = '1425493115053019319';
	const otherGuildId = '1530909114736050316';
	experimentRows = [
		{ name: 'zulu', rangeStart: 0, rangeEnd: 10_000 },
		{ name: 'alpha', rangeStart: 0, rangeEnd: 10_000 },
		{ name: 'nobody', rangeStart: 0, rangeEnd: 0 },
	];
	overrideRows = [{ experimentName: 'nobody', guildId }];
	await loadExperiments();

	// Sorted rather than in row order so the list is stable across refreshes -- it rides a cached `/me`
	// payload, and a reordering would look like a change to anything diffing it.
	expect(enabledExperimentsFor(guildId)).toStrictEqual(['alpha', 'nobody', 'zulu']);
	expect(enabledExperimentsFor(otherGuildId)).toStrictEqual(['alpha', 'zulu']);
});

// The override-only case `isExperimentEnabled` already handles has to be reachable here too -- the candidate
// set is built from the range rows, so a name that only exists as an override would drop out of the list
// while still reading as enabled, which is exactly the kind of disagreement between the two that would hide
// a gate from the dashboard while the API honoured it.
test('enabledExperimentsFor includes an override-only experiment', async () => {
	const guildId = '1425493115053019319';
	overrideRows = [{ experimentName: 'orphaned', guildId }];
	await loadExperiments();

	expect(enabledExperimentsFor(guildId)).toStrictEqual(['orphaned']);
	expect(enabledExperimentsFor('1530909114736050316')).toStrictEqual([]);
});

// Listing candidates must not trip the unknown-experiment warning: every name it checks came out of the
// snapshot, so warning about any of them would be pure noise on a path that runs per guild per `/me`.
//
// The guild that is *not* the override's target is the case that matters, and the one an earlier version of
// this test missed: an override-only name is in the candidate set for every call, but only the target guild
// short-circuits on the override, so every other guild used to fall through to the unknown-experiment branch.
// `me.ts` runs this once per guild in the user's list, so that was a line per uninvolved guild.
test('enabledExperimentsFor does not warn, for the override target or anyone else', async () => {
	experimentRows = [{ name: 'alpha', rangeStart: 0, rangeEnd: 10_000 }];
	overrideRows = [{ experimentName: 'orphaned', guildId: '1425493115053019319' }];
	await loadExperiments();

	enabledExperimentsFor('1425493115053019319');
	enabledExperimentsFor('1530909114736050316');

	expect(warn).not.toHaveBeenCalled();
});

// The flip side of the split: taking the warning out of `enabledExperimentsFor`'s path must not take it out of
// the one place it earns its keep -- a gate the code checks by name that nobody has created.
test('isExperimentEnabled still warns for a genuinely unknown experiment', async () => {
	experimentRows = [{ name: 'alpha', rangeStart: 0, rangeEnd: 10_000 }];
	overrideRows = [{ experimentName: 'orphaned', guildId: '1425493115053019319' }];
	await loadExperiments();

	expect(isExperimentEnabled('never-created', '1530909114736050316')).toBe(false);
	expect(warn).toHaveBeenCalledTimes(1);

	// An override for this exact guild counts as the gate existing, range row or not -- that path returns true
	// and must stay silent.
	expect(isExperimentEnabled('orphaned', '1425493115053019319')).toBe(true);
	expect(warn).toHaveBeenCalledTimes(1);
});
