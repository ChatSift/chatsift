import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorBypassRoles } from '@chatsift/db';

/**
 * Filter bypass roles (P5, feature 10): roles whose holders every filter declines to punish.
 *
 * Deliberately *below* Discord's own per-rule exempt roles rather than a replacement for them. An exempt role
 * on the native rule means the match never happens, so nothing is logged and nothing is decided. A bypass role
 * here means the match happened, the filter log records it, and only the response is skipped. Both are useful
 * and they answer different questions -- which is why this exists rather than telling guilds to use Discord's
 * list and nothing else.
 *
 * Takes the member's roles rather than fetching them, because every caller already has to have the member for
 * another reason: `AUTO_MODERATION_ACTION_EXECUTION` carries no member object at all, so the tag that goes on
 * the case row comes from the same lookup this check would otherwise duplicate.
 *
 * Returns the role id rather than a boolean so the decision trace and the filter log can name *which* role let
 * them off -- which is the follow-up "so why wasn't this person banned" always produces.
 */
export async function findBypassRole(guildId: string, roleIds: readonly string[]): Promise<string | null> {
	if (roleIds.length === 0) {
		return null;
	}

	const rows = await getContext().db<Pick<AutomoderatorBypassRoles, 'roleId'>[]>`
		SELECT role_id FROM automoderator_bypass_roles WHERE guild_id = ${guildId}
	`;

	// `.toString()` because kanel brands primary-key columns -- the same widening `logExemptions.ts` needs.
	const bypass = new Set(rows.map((row) => row.roleId.toString()));
	return roleIds.find((roleId) => bypass.has(roleId)) ?? null;
}
