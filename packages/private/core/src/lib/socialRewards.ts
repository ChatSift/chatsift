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
 * What a member at `level` should be holding out of `rewards`.
 *
 * The schema permits two clean rewards at the same level, so the tie has to break on something -- and it
 * deliberately breaks on the lower `roleId` rather than on input order. The bot reads its rewards from an
 * unordered `SELECT` while the dashboard reads them `ORDER BY level, role_id`, so an order-dependent rule would
 * let the ladder confidently draw a tier the bot then doesn't grant.
 */
export function resolveEarnedRewards(rewards: readonly RewardRule[], level: number): EarnedRewards {
	const earned = rewards.filter((reward) => reward.level <= level);

	return {
		stacking: earned.filter((reward) => !reward.clean),
		tier: earned
			.filter((reward) => reward.clean)
			.reduce<RewardRule | null>((highest, reward) => {
				if (highest === null || reward.level > highest.level) {
					return reward;
				}

				return reward.level === highest.level && reward.roleId < highest.roleId ? reward : highest;
			}, null),
	};
}
