/**
 * The reward-tier rule (#343), shared because two very different places have to agree on it exactly: the bot
 * decides which roles a member actually ends up holding, and the dashboard's reward ladder tells an admin what
 * their configuration will do before anyone reaches it. A second reading of "clean" in either would make the
 * dashboard confidently describe rewards nobody gets.
 */

/**
 * Structural rather than a `social_rewards` row: `@chatsift/db` brands its id columns and none of this needs
 * that, which is also what lets the rule be exercised with plain fixtures. A real row satisfies it as-is.
 */
export interface RewardRule {
	clean: boolean;
	level: number;
	roleId: string;
}

/**
 * Discord's own role positions, keyed by role id -- higher is further up the guild's role list. Every tie in
 * this file breaks on it, so callers pass whatever their own role cache already holds: the bot's
 * `discordCache`, the dashboard's `useGuildInfo`, the API's `fetchGuildRoles`.
 *
 * A role the map doesn't have -- one deleted since it was configured, or a guild whose roles couldn't be read
 * at all -- sorts to the bottom, and the tie then falls back to the lower role id. That fallback is what keeps
 * the result deterministic rather than dependent on input order: the bot reads its rewards from an unordered
 * `SELECT` while the dashboard reads them `ORDER BY level, role_id`, so an order-dependent rule would let the
 * ladder confidently draw a tier the bot then doesn't grant.
 */
export type RolePositions = ReadonlyMap<string, number>;

export interface EarnedRewards {
	/**
	 * Every non-`clean` reward at or below the level, in the order given. These accumulate -- nothing ever takes
	 * one back off, including a later tier.
	 */
	stacking: RewardRule[];
	/**
	 * The one `clean` reward held at this level: the highest-level one at or below it, or `null` when none is
	 * configured that low. Clean rewards only ever supersede *each other* -- a tier promotion never touches a
	 * stacking reward.
	 */
	tier: RewardRule | null;
}

/**
 * Whether `candidate` is the higher reward of the two: a higher level first, then -- since the schema permits
 * two rewards at the same level -- the one higher up the guild's role hierarchy, then the lower role id.
 */
function outranks(candidate: RewardRule, incumbent: RewardRule, positions: RolePositions): boolean {
	if (candidate.level !== incumbent.level) {
		return candidate.level > incumbent.level;
	}

	const candidatePosition = positions.get(candidate.roleId) ?? Number.NEGATIVE_INFINITY;
	const incumbentPosition = positions.get(incumbent.roleId) ?? Number.NEGATIVE_INFINITY;
	if (candidatePosition !== incumbentPosition) {
		return candidatePosition > incumbentPosition;
	}

	return candidate.roleId < incumbent.roleId;
}

function highest(rewards: readonly RewardRule[], positions: RolePositions): RewardRule | null {
	return rewards.reduce<RewardRule | null>(
		(best, reward) => (best === null || outranks(reward, best, positions) ? reward : best),
		null,
	);
}

/**
 * What a member at `level` should be holding out of `rewards`.
 */
export function resolveEarnedRewards(
	rewards: readonly RewardRule[],
	level: number,
	positions: RolePositions,
): EarnedRewards {
	const earned = rewards.filter((reward) => reward.level <= level);

	return {
		stacking: earned.filter((reward) => !reward.clean),
		tier: highest(
			earned.filter((reward) => reward.clean),
			positions,
		),
	};
}

/**
 * The single reward a member at `level` would name if asked what they'd earned -- the highest one of *either*
 * kind, which is what the leaderboards show beside a row.
 *
 * Deliberately not `resolveEarnedRewards(...).tier`: `clean` defaults to false, so a guild that never touches
 * that checkbox has no tier at all and would get no badge on any row. The clean/stacking split is about what
 * the bot takes back off on a promotion, not about which role is the member's most impressive.
 */
export function resolveHighestReward(
	rewards: readonly RewardRule[],
	level: number,
	positions: RolePositions,
): RewardRule | null {
	return highest(
		rewards.filter((reward) => reward.level <= level),
		positions,
	);
}
