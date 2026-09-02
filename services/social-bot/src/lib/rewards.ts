import { clearTimeout, setTimeout } from 'node:timers';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { RewardRule, RolePositions } from '@chatsift/core';
import { resolveEarnedRewards } from '@chatsift/core';
import { rewardRoles } from './metrics.js';

export type { RewardRule } from '@chatsift/core';

/**
 * Reward-role application (#343 P3, redesign ledger item 2).
 *
 * Legacy recomputed the member's *entire* role set on every eligible message and pushed it with a single
 * `roles.set()`. That approach had to explicitly re-add managed and unrelated roles to avoid stripping them, it
 * raced any other bot touching roles in the same window (last write wins, wholesale), and it carried a confessed
 * bug history around clean tiers. This computes the actual difference instead and issues only that -- managed
 * and unrelated roles stop being a consideration at all, because nothing ever touches them.
 */

export interface RewardRoleDiff {
	add: string[];
	remove: string[];
}

export interface ComputeRewardRoleDiffOptions {
	/**
	 * Role ids the member currently holds, straight off the `MESSAGE_CREATE` payload's `member.roles`.
	 */
	heldRoleIds: readonly string[];
	/**
	 * The level the member is at *after* this grant.
	 */
	level: number;
	/**
	 * The guild's role hierarchy, which decides ties between two rewards configured at the same level. An empty
	 * map is fine (the guild couldn't be read) -- see `RolePositions`.
	 */
	positions: RolePositions;
	/**
	 * Every reward configured in the guild -- not a pre-filtered subset. Superseded clean tiers can only be
	 * identified by looking at rewards above the member's level too.
	 */
	rewards: readonly RewardRule[];
}

/**
 * Pure, so the tier logic is unit-testable without a Discord client.
 *
 * - **Non-clean** rewards accumulate: every one at or below the member's level should be held.
 * - **Clean** rewards are tiers that replace each other: only the highest one at or below the member's level
 *   should be held, and any other clean reward role they're holding is a superseded tier to strip.
 *
 * Nothing outside the guild's configured reward roles ever appears in either list.
 */
export function computeRewardRoleDiff({
	heldRoleIds,
	level,
	positions,
	rewards,
}: ComputeRewardRoleDiffOptions): RewardRoleDiff {
	const held = new Set(heldRoleIds);
	const add = new Set<string>();
	const remove = new Set<string>();

	// Which roles the member *should* hold is `@chatsift/core`'s call, shared with the dashboard's reward ladder
	// so the two can't describe "clean" differently. What's left here is the part that's specific to writing a
	// diff rather than a target set: nothing but a superseded tier is ever taken away.
	const { stacking, tier } = resolveEarnedRewards(rewards, level, positions);

	for (const reward of [...stacking, ...(tier ? [tier] : [])]) {
		if (!held.has(reward.roleId)) {
			add.add(reward.roleId);
		}
	}

	for (const reward of rewards) {
		// Every *other* clean reward role they hold is a tier they've outgrown -- or one they were given early
		// and don't qualify for. Both are equally wrong to keep.
		if (reward.clean && reward.roleId !== tier?.roleId && held.has(reward.roleId)) {
			remove.add(reward.roleId);
		}
	}

	return { add: [...add], remove: [...remove] };
}

/**
 * How long a guild+user pair is skipped after a failed role write.
 *
 * Ported from legacy's own fix for this (before it, a single failure barred the entire guild until restart), but
 * checked *before* attempting rather than inside the try -- legacy tested the bar in the same block it set it,
 * so the bar never actually prevented a retry. The realistic cause is a misconfigured role hierarchy, which
 * doesn't resolve on its own, and without a bar every subsequent message would re-attempt and re-fail.
 */
const FAILURE_BAR_MS = 3 * 60 * 1_000;

const barred = new Map<string, NodeJS.Timeout>();

function barKey(guildId: string, userId: string): string {
	return `${guildId}:${userId}`;
}

function bar(guildId: string, userId: string): void {
	const key = barKey(guildId, userId);
	clearTimeout(barred.get(key));
	// `.unref()` so a pending bar can't hold the process open on shutdown.
	barred.set(key, setTimeout(() => barred.delete(key), FAILURE_BAR_MS).unref());
}

/**
 * The member's role list after applying a diff, preserving the order they already had.
 *
 * Kept separate from the request so it can be reasoned about (and tested) on its own: everything the member holds
 * survives except the superseded tiers, and the additions go on the end.
 */
export function applyDiffToRoles(heldRoleIds: readonly string[], diff: RewardRoleDiff): string[] {
	const removing = new Set(diff.remove);

	return [...heldRoleIds.filter((roleId) => !removing.has(roleId)), ...diff.add];
}

export interface ApplyRewardRolesOptions {
	diff: RewardRoleDiff;
	guildId: string;
	/**
	 * The member's current roles, as they arrived on the `MESSAGE_CREATE` payload being processed.
	 */
	heldRoleIds: readonly string[];
	logger: Logger;
	userId: string;
}

/**
 * Applies the diff as a single `PATCH /guilds/{guild}/members/{user}`.
 *
 * Per-role `PUT`/`DELETE` would be the more surgical write -- each one asserts only the role it names, so it can't
 * clobber a concurrent change -- but those endpoints sit in a much tighter per-guild bucket, and a tier promotion
 * is two of them (add the new tier, drop the old) on top of any non-clean rewards. On a guild where several
 * members level up around the same time that saturates the bucket and stalls every later write behind it. One
 * request per member is worth the tradeoff.
 *
 * The clobber risk is real but small: the role list comes off the very message being processed, and the
 * guild+user lock in `tracking.ts` keeps this bot's own writes from racing each other. A moderator changing roles
 * in the same instant can still lose that change -- the same exposure legacy had with `roles.set()`, except the
 * array here is the member's own roles minus superseded tiers rather than a set rebuilt from scratch.
 *
 * Returns `false` if the write was skipped or failed, so callers can avoid claiming rewards were granted.
 */
export async function applyRewardRoles({
	diff,
	guildId,
	heldRoleIds,
	logger,
	userId,
}: ApplyRewardRolesOptions): Promise<boolean> {
	if (diff.add.length === 0 && diff.remove.length === 0) {
		rewardRoles.inc({ result: 'noop' });
		return true;
	}

	if (barred.has(barKey(guildId, userId))) {
		// The failure that set the bar was logged once; without this the next few minutes of skips are
		// invisible, and each one also strips `earnedRewards` from the level-up message -- so a member gets
		// congratulated with no mention of the role they didn't receive.
		rewardRoles.inc({ result: 'barred' });
		logger.debug({ guildId, userId, add: diff.add, remove: diff.remove }, 'Reward roles skipped, member is barred');

		return false;
	}

	try {
		await getContext().service.client.api.guilds.editMember(
			guildId,
			userId,
			{ roles: applyDiffToRoles(heldRoleIds, diff) },
			{ reason: 'Social level rewards' },
		);

		// Only reached when the diff was non-empty, so this is per-write rather than per-message -- it's the
		// line that answers "did they actually get the role", for both level-ups and the self-healing repair.
		rewardRoles.inc({ result: 'applied' });
		logger.info({ guildId, userId, add: diff.add, remove: diff.remove }, 'Applied reward roles');

		return true;
	} catch (error) {
		rewardRoles.inc({ result: 'failed' });
		bar(guildId, userId);
		logger.warn(
			{ err: error, guildId, userId, add: diff.add, remove: diff.remove },
			'Failed to apply reward roles; skipping this member for a few minutes',
		);

		return false;
	}
}
