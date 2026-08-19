import { getContext } from '@chatsift/backend-core';
import { resolveChannelChain } from '@chatsift/bot-core';
import type { AutomoderatorLogExemptions } from '@chatsift/db';

/**
 * Log exemptions (P4, feature 35): channels whose message activity is never logged.
 *
 * Matched **up the channel tree**, not just exactly. A message in a thread is exempt if the thread, its parent
 * channel, or that channel's category is listed, so "stop logging this whole category" is one row rather than
 * one per channel that will ever exist under it. Legacy resolved the same two levels but dropped the message's
 * own channel from the comparison when it was a thread, so exempting a thread by id did nothing at all.
 *
 * The walk itself is `@chatsift/bot-core`'s `resolveChannelChain` -- Social already needed the identical
 * three-level lookup for its per-category XP multipliers, so this reuses that cache rather than warming a
 * second one.
 */

/**
 * The exempt channel id covering this message's channel, or `null` if none does. Returns the id rather than a
 * boolean so the decision trace can name *which* row stopped the log -- "why isn't this channel logging" is the
 * question this feature generates, and "the exemption on the category" is the answer.
 *
 * Which way this fails, because both directions are reachable and they are not symmetric:
 *
 * - A channel the bot **cannot read** ends the walk, so an exemption set on a category the bot has no View
 *   Channel on does not apply and the message *is* logged. Unavoidable: nothing else in the payload names the
 *   category, and Discord will not describe a channel the bot cannot see. Narrow in practice, since children
 *   inherit category permissions unless somebody has overridden them.
 * - A **transient** failure (a 5xx, the proxy restarting) propagates instead of being swallowed, so the
 *   caller's handler drops that log line entirely. That is the deliberate direction: an exemption that cannot
 *   be evaluated should suppress the log rather than guess, and a lost line is counted as
 *   `automoderator_feature_invocations_total{outcome="failed"}` where an over-logged one would be silent.
 */
export async function findLogExemption(guildId: string, channelId: string): Promise<string | null> {
	const exempt = await listExemptChannelIds(guildId);

	// Short-circuits before touching Discord at all, which is the shape almost every guild is in: no
	// exemptions means no channel lookups, ever.
	if (exempt.size === 0) {
		return null;
	}

	for (const candidate of await resolveChannelChain(getContext().service.client.api, channelId)) {
		if (exempt.has(candidate)) {
			return candidate;
		}
	}

	return null;
}

async function listExemptChannelIds(guildId: string): Promise<Set<string>> {
	const rows = await getContext().db<Pick<AutomoderatorLogExemptions, 'channelId'>[]>`
		SELECT channel_id FROM automoderator_log_exemptions WHERE guild_id = ${guildId}
	`;

	return new Set(rows.map((row) => row.channelId.toString()));
}
