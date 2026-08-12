import { expect, test, vi } from 'vitest';

// Only the pure diff is under test here, but the module it lives in also holds the applier -- which reaches for
// the ambient context, and importing the real `@chatsift/backend-core` eagerly parses the env schema.
vi.mock('@chatsift/backend-core', () => ({ getContext: () => ({ service: { client: { api: {} } } }) }));

const { applyDiffToRoles, computeRewardRoleDiff } = await import('../rewards.js');

const NEWCOMER = '1000';
const REGULAR = '2000';
const VETERAN = '3000';
const HELPER = '4000';
const UNRELATED = '9000';

/**
 * Role positions only ever decide a tie between two rewards configured at the *same* level, which none of the
 * fixtures below have -- so every test but the last one passes an empty hierarchy, exactly as the bot does for
 * a guild it can't currently read.
 */
const NO_POSITIONS = new Map<string, number>();

/**
 * Tiered ("clean") rewards replace each other; non-clean ones accumulate. This is redesign ledger item 2 of #343
 * -- legacy rebuilt the member's whole role set instead of diffing, which is what made managed and unrelated
 * roles something it had to explicitly preserve.
 */
const TIERS = [
	{ clean: true, level: 1, roleId: NEWCOMER },
	{ clean: true, level: 5, roleId: REGULAR },
	{ clean: true, level: 10, roleId: VETERAN },
] as const;

test('non-clean rewards accumulate', () => {
	const rewards = [
		{ clean: false, level: 1, roleId: NEWCOMER },
		{ clean: false, level: 5, roleId: REGULAR },
		{ clean: false, level: 10, roleId: VETERAN },
	];

	const diff = computeRewardRoleDiff({ heldRoleIds: [], level: 5, positions: NO_POSITIONS, rewards });

	expect(diff.add.toSorted((a, b) => a.localeCompare(b))).toStrictEqual([NEWCOMER, REGULAR]);
	expect(diff.remove).toStrictEqual([]);
});

test('only the highest clean tier is held', () => {
	const diff = computeRewardRoleDiff({ heldRoleIds: [], level: 7, positions: NO_POSITIONS, rewards: TIERS });

	expect(diff.add).toStrictEqual([REGULAR]);
	expect(diff.remove).toStrictEqual([]);
});

test('a promotion swaps the previous tier out', () => {
	const diff = computeRewardRoleDiff({ heldRoleIds: [REGULAR], level: 10, positions: NO_POSITIONS, rewards: TIERS });

	expect(diff.add).toStrictEqual([VETERAN]);
	expect(diff.remove).toStrictEqual([REGULAR]);
});

test('a tier the member no longer qualifies for is stripped', () => {
	// Reachable when an admin raises a reward's level, or hand-assigns a tier role.
	const diff = computeRewardRoleDiff({ heldRoleIds: [VETERAN], level: 5, positions: NO_POSITIONS, rewards: TIERS });

	expect(diff.add).toStrictEqual([REGULAR]);
	expect(diff.remove).toStrictEqual([VETERAN]);
});

test('nothing happens when the member already has exactly the right roles', () => {
	const rewards = [...TIERS, { clean: false, level: 3, roleId: HELPER }];
	const diff = computeRewardRoleDiff({ heldRoleIds: [REGULAR, HELPER], level: 5, positions: NO_POSITIONS, rewards });

	expect(diff.add).toStrictEqual([]);
	expect(diff.remove).toStrictEqual([]);
});

test('roles that are not rewards are never touched', () => {
	// The property that makes managed roles (boosters, bot roles) a non-issue by construction -- unlike legacy,
	// which had to re-add them explicitly because it replaced the whole role set.
	const diff = computeRewardRoleDiff({ heldRoleIds: [UNRELATED, REGULAR], level: 5, positions: NO_POSITIONS, rewards: TIERS });

	expect(diff.add).toStrictEqual([]);
	expect(diff.remove).toStrictEqual([]);
});

test('a level 0 member earns nothing and keeps nothing', () => {
	const diff = computeRewardRoleDiff({ heldRoleIds: [NEWCOMER], level: 0, positions: NO_POSITIONS, rewards: TIERS });

	expect(diff.add).toStrictEqual([]);
	expect(diff.remove).toStrictEqual([NEWCOMER]);
});

test('clean and non-clean rewards coexist', () => {
	const rewards = [...TIERS, { clean: false, level: 2, roleId: HELPER }];
	const diff = computeRewardRoleDiff({ heldRoleIds: [NEWCOMER], level: 5, positions: NO_POSITIONS, rewards });

	expect(diff.add.toSorted((a, b) => a.localeCompare(b))).toStrictEqual(
		[REGULAR, HELPER].toSorted((a, b) => a.localeCompare(b)),
	);
	expect(diff.remove).toStrictEqual([NEWCOMER]);
});

test('a multi-level jump grants every tier it crossed at once', () => {
	// #343 P3 announces the true new level rather than legacy's `oldLevel + 1`, so the diff has to cope with a
	// member arriving at level 10 straight from 0.
	const rewards = [...TIERS, { clean: false, level: 3, roleId: HELPER }];
	const diff = computeRewardRoleDiff({ heldRoleIds: [], level: 10, positions: NO_POSITIONS, rewards });

	expect(diff.add.toSorted((a, b) => a.localeCompare(b))).toStrictEqual(
		[HELPER, VETERAN].toSorted((a, b) => a.localeCompare(b)),
	);
	expect(diff.remove).toStrictEqual([]);
});

test('two clean tiers at the same level are decided by the role hierarchy', () => {
	// A misconfiguration rather than a normal setup, but one the schema permits -- and whichever of the two the
	// bot grants, the dashboard's ladder and the leaderboards have to name the same one, which is why the rule
	// (and the hierarchy it breaks on) lives in `@chatsift/core` rather than here.
	const rewards = [
		{ clean: true, level: 5, roleId: REGULAR },
		{ clean: true, level: 5, roleId: HELPER },
	];
	const positions = new Map([
		[REGULAR, 3],
		[HELPER, 7],
	]);

	const diff = computeRewardRoleDiff({ heldRoleIds: [], level: 5, positions, rewards });

	expect(diff.add).toStrictEqual([HELPER]);
	expect(diff.remove).toStrictEqual([]);
});

test('the patched role array keeps everything the member already had', () => {
	// The whole-member PATCH sends an absolute role list, so anything missing from it is stripped. This is the
	// property that keeps managed roles (boosters, bot roles) and unrelated roles alive.
	const next = applyDiffToRoles([UNRELATED, NEWCOMER, HELPER], { add: [REGULAR], remove: [NEWCOMER] });

	expect(next).toStrictEqual([UNRELATED, HELPER, REGULAR]);
});

test('the patched role array is a no-op shape when nothing is removed', () => {
	expect(applyDiffToRoles([UNRELATED], { add: [HELPER], remove: [] })).toStrictEqual([UNRELATED, HELPER]);
});

test('the patched role array never duplicates a role', () => {
	// `computeRewardRoleDiff` only ever adds roles the member doesn't hold, so this is belt-and-braces -- but a
	// duplicate in a PATCH body is exactly the kind of thing Discord would reject the whole request over.
	const diff = computeRewardRoleDiff({ heldRoleIds: [REGULAR], level: 5, positions: NO_POSITIONS, rewards: TIERS });
	const next = applyDiffToRoles([REGULAR], diff);

	expect(new Set(next).size).toBe(next.length);
});
