import { getContext } from '@chatsift/backend-core';
import type { Client } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { banEvents } from './metrics.js';

/**
 * Keeps `appeal_ban_checks` fresh from the gateway (#232).
 *
 * **This updates rows; it never inserts them.** That single restriction is what keeps the table the thing its
 * schema comment says it is -- a cache of probes we actually performed -- rather than the gateway-mirrored ban
 * index docs/roadmap/09-appeals.md §4 rejects. Inserting here would mean a row for every ban in every guild
 * Appeals is installed in, forever, overwhelmingly for people who will never appeal; and it would still be
 * incomplete, since bans issued before the bot joined produce no event. An incomplete table that looks
 * authoritative is worse than no table.
 *
 * So the probe stays the authority and this is pure cache maintenance: an appellant who checked a guild and was
 * since unbanned by hand sees that without spending another probe, and later phases get a hook for closing an
 * open appeal whose ban was lifted underneath it.
 */
async function prime(guildId: string, userId: string, banned: boolean): Promise<number> {
	// `ban_reason` is cleared rather than preserved on a ban. GUILD_BAN_ADD carries `{ guild_id, user }` and no
	// reason, so the honest value here is "unknown" -- keeping a previous ban's reason would hand P8's pattern
	// matching a string describing a punishment that is no longer the one being appealed.
	const rows = await getContext().db`
		UPDATE appeal_ban_checks
		SET banned = ${banned}, ban_reason = NULL, checked_at = now()
		WHERE user_id = ${userId} AND guild_id = ${guildId}
	`;

	return rows.count;
}

export function registerBanEvents(client: Client): void {
	for (const [event, kind, banned] of [
		[GatewayDispatchEvents.GuildBanAdd, 'add', true],
		[GatewayDispatchEvents.GuildBanRemove, 'remove', false],
	] as const) {
		// The try/catch is mandatory, not defensive: discord.js-core re-emits a rejected listener as an `'error'`
		// event, which `registerFatalErrorHandlers` treats as fatal.
		client.on(event, async ({ data }) => {
			const logger = getContext().logger.child({ event, guildId: data.guild_id, userId: data.user.id });

			try {
				// `uncached` is the common case and not a failure -- nobody has ever probed this user against this
				// guild, so there is no cached answer to keep fresh. Split from `refreshed` because the two answer
				// different questions: the pair climbing at all proves the GuildModeration intent is delivering,
				// while `refreshed` alone is the only evidence the priming does any work.
				const refreshed = await prime(data.guild_id, data.user.id, banned);
				banEvents.inc({ kind, outcome: refreshed > 0 ? 'refreshed' : 'uncached' });
			} catch (error) {
				banEvents.inc({ kind, outcome: 'failed' });
				logger.error({ err: error }, 'failed to prime a cached ban check');
			}
		});
	}
}
