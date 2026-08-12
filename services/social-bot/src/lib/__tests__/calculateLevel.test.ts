import { expect, test } from 'vitest';
import { calculateTotalRequiredXp, calculateUserLevel } from '../calculateLevel.js';

/**
 * These pin the migration-fidelity guarantee (#343): every migrated user's level is re-derived from their XP
 * through this curve, so a change here silently re-levels the entire user base. See `calculateLevel.ts`'s header
 * for why the formula stays as-is despite looking wrong against its own cited derivation.
 */

// The worked example from the blog post the curve comes from.
const BASE = 100;
const MULTIPLIER = 50;

test('the curve matches the closed form of its source series', () => {
	// base + m * x(x-1)/2 -- coefficients of m are the triangular numbers 0, 1, 3, 6, 10, 15.
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 1)).toBe(100);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 2)).toBe(150);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 3)).toBe(250);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 4)).toBe(400);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 5)).toBe(600);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 6)).toBe(850);
});

test('base is charged once, not once per level', () => {
	// The distinguishing property against the prose reading (`x * base + m * x(x-1)/2`), which would put level 3
	// at 450 rather than 250. Named explicitly so a future "fix" fails here with the reason attached.
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 3)).toBe(250);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 10)).toBe(2_350);

	// Equivalently: the marginal cost of a level is m * (level - 1), with no base term.
	const marginal = calculateTotalRequiredXp(BASE, MULTIPLIER, 7) - calculateTotalRequiredXp(BASE, MULTIPLIER, 6);
	expect(marginal).toBe(MULTIPLIER * 6);
});

test('a user below the level 1 threshold is level 0', () => {
	expect(calculateUserLevel(BASE, MULTIPLIER, 0)).toBe(0);
	expect(calculateUserLevel(BASE, MULTIPLIER, 99)).toBe(0);
});

test('level derivation lands exactly on each threshold', () => {
	// Reaching a threshold exactly is enough to hold the level -- the walk compares with `<`, not `<=`.
	expect(calculateUserLevel(BASE, MULTIPLIER, 100)).toBe(1);
	expect(calculateUserLevel(BASE, MULTIPLIER, 149)).toBe(1);
	expect(calculateUserLevel(BASE, MULTIPLIER, 150)).toBe(2);
	expect(calculateUserLevel(BASE, MULTIPLIER, 249)).toBe(2);
	expect(calculateUserLevel(BASE, MULTIPLIER, 250)).toBe(3);
	expect(calculateUserLevel(BASE, MULTIPLIER, 2_350)).toBe(10);
});

test('level 0 costs nothing', () => {
	// Legacy threw on `level <= 0` and made every caller special-case it; returning 0 keeps `/level`'s
	// progress arithmetic (`xp - totalRequired(level)`) correct at level 0 without a branch.
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, 0)).toBe(0);
	expect(calculateTotalRequiredXp(BASE, MULTIPLIER, -1)).toBe(0);
});

test('level derivation terminates on settings the DB CHECKs are supposed to prevent', () => {
	// A 0 multiplier makes every level past the first free, which would spin the walk forever. The CHECKs in
	// schema.sql rule this out, but the guard matters because this runs on every tracked message.
	expect(calculateUserLevel(BASE, 0, 1_000_000)).toBe(0);
	expect(calculateUserLevel(0, MULTIPLIER, 1_000_000)).toBe(0);
});

test('a steep curve still derives correctly', () => {
	// The configurable maximums (base 500, multiplier 100) -- guards against an overflow-ish regression in the
	// closed form at the top of the allowed range.
	expect(calculateTotalRequiredXp(500, 100, 20)).toBe(19_500);
	expect(calculateUserLevel(500, 100, 19_500)).toBe(20);
	expect(calculateUserLevel(500, 100, 19_499)).toBe(19);
});
