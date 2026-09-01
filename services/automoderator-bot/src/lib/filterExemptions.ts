import { getContext } from '@chatsift/backend-core';
import { resolveChannelChain } from '@chatsift/bot-core';
import type { AutomoderatorFilterExemptions, AutomoderatorFilterKind } from '@chatsift/db';

/**
 * Filter exemptions (P5b, feature 09): channels a runner filter never acts in.
 *
 * Matched **up the channel tree** by `resolveChannelChain`, exactly like `logExemptions.ts` -- a message in a
 * thread is exempt if the thread, its parent channel, or that channel's category is listed. Legacy resolved the
 * same two levels but dropped the message's own channel when it was a thread, so exempting a thread by id did
 * nothing at all.
 *
 * **Consulted before the runners rather than after**, which is the one place this differs from the bypass-role
 * check in `automodIntake.ts`. A native AutoMod hit arrives with Discord's matching already done and paid for,
 * so saying "skipped, this role bypasses" in the filter log costs nothing. Here the match is ours to make, and
 * making it just to announce that we are about to ignore it would spend an invite resolution per staff message.
 * The reason still gets recorded -- as a decision trace, which is where "why did nothing happen" is answered
 * for every other short-circuit in this service.
 */

/**
 * Runtime values for `automoderator_filter_kind`. Same arrangement, and the same reason, as `guildLog.ts`'s
 * `LOG_TYPE`: kanel generates the enum as a real TypeScript enum but `@chatsift/db` re-exports only its type,
 * so there is no value to reference and a bare `'URLS'` is not assignable to it.
 */
export const FILTER_KIND = {
	URLS: 'URLS' as AutomoderatorFilterKind,
	INVITES: 'INVITES' as AutomoderatorFilterKind,
	ANTISPAM: 'ANTISPAM' as AutomoderatorFilterKind,
} as const satisfies Record<string, AutomoderatorFilterKind>;

export type RunnerFilterKind = keyof typeof FILTER_KIND;

/**
 * Which of `kinds` this channel is exempt from, mapped to the channel id that granted it -- the category, the
 * parent, or the channel itself. The id rather than a boolean for the same reason `findLogExemption` returns
 * one: "why isn't this channel filtered" is answered by "the exemption on the category", not by "yes".
 *
 * One database read and at most one channel-chain walk regardless of how many kinds are asked about, which is
 * what makes running both filters cost the same as running one.
 *
 * Which way this fails, matching `findLogExemption` because the trade-off is identical:
 *
 * - A channel the bot **cannot read** ends the walk, so an exemption on a category it has no View Channel on
 *   does not apply and the message *is* filtered. Narrow in practice, since children inherit category
 *   permissions unless somebody has overridden them.
 * - A **transient** failure propagates rather than being swallowed, so the caller drops the message rather than
 *   guessing. Deliberate: an exemption that cannot be evaluated should suppress the filter, because deleting
 *   somebody's message on the strength of a failed lookup is the irreversible direction.
 */
export async function findFilterExemptions(
	guildId: string,
	channelId: string,
	kinds: readonly RunnerFilterKind[],
): Promise<Map<RunnerFilterKind, string>> {
	const exempt = new Map<RunnerFilterKind, Set<string>>();

	const rows = await getContext().db<Pick<AutomoderatorFilterExemptions, 'channelId' | 'filter'>[]>`
		SELECT channel_id, filter FROM automoderator_filter_exemptions
		WHERE guild_id = ${guildId} AND filter = ANY(${kinds as unknown as string[]})
	`;

	for (const row of rows) {
		const kind = row.filter as unknown as RunnerFilterKind;
		const channels = exempt.get(kind) ?? new Set<string>();
		// `.toString()` because kanel brands primary-key columns.
		channels.add(row.channelId.toString());
		exempt.set(kind, channels);
	}

	const found = new Map<RunnerFilterKind, string>();

	// Short-circuits before touching Discord at all, which is the shape almost every guild is in: no exemptions
	// means no channel lookups, ever.
	if (exempt.size === 0) {
		return found;
	}

	const chain = await resolveChannelChain(getContext().service.client.api, channelId);

	for (const [kind, channels] of exempt) {
		const match = chain.find((candidate) => channels.has(candidate));
		if (match !== undefined) {
			found.set(kind, match);
		}
	}

	return found;
}
