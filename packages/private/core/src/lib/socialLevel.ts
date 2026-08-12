/**
 * Social's XP curve (#343). Shared rather than living in `services/social-bot` because the dashboard's config
 * form previews it (P4) and every migrated user's level is re-derived through it (P5) -- a second copy of the
 * formula anywhere would be a silent re-levelling waiting to happen. Deliberately unchanged from legacy despite
 * looking wrong against the derivation it cites; the argument is in docs/roadmap/10-social-port.md's P3 entry.
 */

/**
 * Total (cumulative) XP needed to *be* `level`. `level` is 1-based; level 0 needs no XP at all and is what
 * everyone starts at, so callers asking about it should short-circuit rather than call this with 0 -- legacy
 * threw on `level <= 0` and its `/level` command special-cased it for exactly that reason.
 */
export function calculateTotalRequiredXp(base: number, multiplier: number, level: number): number {
	if (level <= 0) {
		return 0;
	}

	// `level * (level - 1)` is always even, so this never produces a fraction.
	return base + (multiplier * (level * (level - 1))) / 2;
}

/**
 * Walks levels upward until the accumulated requirement outruns `xp`. O(level), which is fine at any XP magnitude
 * an int4 column can hold.
 *
 * Termination rests on the requirement strictly growing, which is what the `required_xp_base >= 1` and
 * `required_xp_multiplier >= 1` CHECKs in schema.sql exist to guarantee -- a `multiplier` of 0 would make every
 * level past the first cost nothing and spin here forever. Guarded anyway rather than trusted, since this runs on
 * a message hot path and a hang is a far worse failure than a wrong number.
 */
export function calculateUserLevel(base: number, multiplier: number, xp: number): number {
	if (multiplier <= 0 || base <= 0) {
		return 0;
	}

	for (let level = 1; ; level++) {
		if (xp < calculateTotalRequiredXp(base, multiplier, level)) {
			return level - 1;
		}
	}
}
