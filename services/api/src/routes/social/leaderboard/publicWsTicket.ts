import { createWsTicket, getContext } from '@chatsift/backend-core';
import { socialLeaderboardChannel } from '@chatsift/core';
import type { SocialGuildSettings } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface PublicLeaderboardWsTicketResult {
	ticket: string;
}

/**
 * Unauthenticated counterpart to `routes/ws/getTicket.ts`, for the public leaderboard page -- same role
 * AMA's `questions/publicWsTicket.ts` plays for its answers page, and separate from the data route for the
 * same reason: tickets live 60 seconds and the client re-mints on every reconnect, while the page's own
 * response is a long-lived query cache entry a ticket would have expired out of by the first one.
 *
 * The minted ticket carries no `adminGuilds` and no admin bypass -- just the one leaderboard channel in its
 * explicit allowlist. That matters here more than it does for AMA: this channel *is* guild-shaped
 * (`social:<guildId>:leaderboard`), so a ticket with this guild in `adminGuilds` would reach every other
 * Social channel under it. An empty `adminGuilds` means the gateway's guild-wide path can't fire at all, and
 * exact-match on the allowlist is the only way this ticket authorizes anything.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/social/public/:guildId/ws-ticket',
	schema: {
		params: paramsSchema,
	},
	async handler(req, res): Promise<PublicLeaderboardWsTicketResult> {
		const { guildId } = req.params;

		const [settings] = await getContext().db<Pick<SocialGuildSettings, 'publicLeaderboard'>[]>`
			SELECT public_leaderboard FROM social_guild_settings WHERE guild_id = ${guildId}
		`;

		// Same message and same indistinguishability as the data route -- a ticket must not become the way to
		// find out whether a guild has a leaderboard it isn't publishing.
		if (!settings?.publicLeaderboard) {
			throw notFound('Leaderboard not found');
		}

		const ticket = createWsTicket({
			sub: `public-leaderboard:${guildId}`,
			adminGuilds: [],
			channels: [socialLeaderboardChannel(guildId)],
			isAdmin: false,
		});

		// This is a bearer credential (short-lived, but still) -- must never be cached by a shared/intermediate cache.
		res.setHeader('Cache-Control', 'no-store');

		return { ticket };
	},
});
