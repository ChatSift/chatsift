import { expect, test } from 'vitest';
import { resolveEarnedRewards, resolveHighestReward } from '../socialRewards.js';

const MEMBER = '1000';
const REGULAR = '2000';
const VETERAN = '3000';
const HELPER = '4000';

const LADDER = [
	{ clean: false, level: 1, roleId: MEMBER },
	{ clean: true, level: 5, roleId: REGULAR },
	{ clean: false, level: 8, roleId: HELPER },
	{ clean: true, level: 10, roleId: VETERAN },
];

// Discord's own ordering: higher is further up the guild's role list. Deliberately *not* the same order as the
// levels above, so a test that accidentally agreed with level order would still be caught.
const POSITIONS = new Map([
	[MEMBER, 1],
	[REGULAR, 9],
	[HELPER, 4],
	[VETERAN, 6],
]);

const NO_POSITIONS = new Map<string, number>();

test('stacking rewards accumulate and only the highest clean tier is held', () => {
	const { stacking, tier } = resolveEarnedRewards(LADDER, 9, POSITIONS);

	expect(stacking.map((reward) => reward.roleId)).toStrictEqual([MEMBER, HELPER]);
	expect(tier?.roleId).toBe(REGULAR);
});

test('nothing is earned below the lowest reward', () => {
	const { stacking, tier } = resolveEarnedRewards(LADDER, 0, POSITIONS);

	expect(stacking).toStrictEqual([]);
	expect(tier).toBeNull();
});

test('the highest reward is the highest level of either kind', () => {
	// The stacking `HELPER` at level 8 outranks the clean tier at 5, which is the whole reason the leaderboards
	// don't just render `resolveEarnedRewards(...).tier`.
	expect(resolveHighestReward(LADDER, 9, POSITIONS)?.roleId).toBe(HELPER);
	expect(resolveHighestReward(LADDER, 10, POSITIONS)?.roleId).toBe(VETERAN);
	expect(resolveHighestReward(LADDER, 0, POSITIONS)).toBeNull();
});

test('a guild with no clean rewards at all still has a highest reward', () => {
	const stackingOnly = LADDER.map((reward) => ({ ...reward, clean: false }));

	expect(resolveEarnedRewards(stackingOnly, 10, POSITIONS).tier).toBeNull();
	expect(resolveHighestReward(stackingOnly, 10, POSITIONS)?.roleId).toBe(VETERAN);
});

test('a tie at the same level breaks on the role hierarchy', () => {
	const tied = [
		{ clean: true, level: 5, roleId: REGULAR },
		{ clean: true, level: 5, roleId: HELPER },
	];

	// `REGULAR` is higher up the guild's list (9 vs 4) despite sorting after `HELPER` by id, so a rule that
	// still broke on the id would pick the other one.
	expect(resolveEarnedRewards(tied, 5, POSITIONS).tier?.roleId).toBe(REGULAR);
	expect(resolveHighestReward(tied, 5, POSITIONS)?.roleId).toBe(REGULAR);
});

test('a tie between roles with no known position falls back to the lower role id', () => {
	// What every caller gets when the guild's roles can't be read -- the answer has to stay the same for all of
	// them regardless, since the bot reads its rewards unordered and the dashboard reads them ordered.
	const tied = [
		{ clean: true, level: 5, roleId: VETERAN },
		{ clean: true, level: 5, roleId: REGULAR },
	];

	expect(resolveEarnedRewards(tied, 5, NO_POSITIONS).tier?.roleId).toBe(REGULAR);
	expect(resolveEarnedRewards(tied.toReversed(), 5, NO_POSITIONS).tier?.roleId).toBe(REGULAR);
});

test('a role missing from the hierarchy loses to one that is in it', () => {
	// A reward whose role was deleted: it sorts to the bottom rather than winning by id.
	const tied = [
		{ clean: true, level: 5, roleId: MEMBER },
		{ clean: true, level: 5, roleId: '9999' },
	];

	expect(resolveHighestReward(tied, 5, POSITIONS)?.roleId).toBe(MEMBER);
});
