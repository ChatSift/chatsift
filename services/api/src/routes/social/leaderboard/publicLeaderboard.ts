import { getContext } from '@chatsift/backend-core';
import { socialLeaderboardChannel } from '@chatsift/core';
import type { SocialGuildSettings } from '@chatsift/db';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { leaderboardQuerySchema } from '../schemas.js';
import type { LeaderboardPage } from './util.js';
import { buildLeaderboardPage } from './util.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface PublicLeaderboardResult extends LeaderboardPage {
	guildIconUrl: string | null;
	/**
	 * Best-effort: `null` when the bot can't currently read the guild (kicked, an outage), which costs the
	 * page its heading and nothing else. Not worth failing a whole leaderboard over.
	 */
	guildName: string | null;
	/**
	 * WS gateway channel this page's data is invalidated on. Handed back by the server rather than built
	 * client-side purely to keep one source of truth for the string -- unlike AMA's public page, this viewer
	 * does already know the id it's derived from.
	 */
	realtimeChannel: string;
}

/**
 * Unauthenticated, read-only view of a guild's leaderboard, gated solely on `public_leaderboard`. The URL
 * carries the plain guild id: there is one leaderboard per guild, and an unguessable token would only make
 * the page unlisted (whoever holds the link can forward it) at the cost of a second identifier to store,
 * rotate and keep a realtime channel in step with. See schema.sql's `public_leaderboard` comment.
 *
 * Rows go through `toPublicUserInfo`, which emits no member id as a field. It does **not** make the page
 * id-free: a Discord avatar URL is `/avatars/<userId>/<hash>.png`, so anyone with a custom avatar has their
 * snowflake inside `avatarUrl`. See that helper for what the guarantee actually is and what removing the id
 * would cost. AMA's public answers page has the same property, and predates this one.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/social/public/:guildId',
	schema: {
		params: paramsSchema,
		query: leaderboardQuerySchema,
	},
	async handler(req): Promise<PublicLeaderboardResult> {
		const { guildId } = req.params;
		const { limit, offset } = req.query;

		const [settings] = await getContext().db<
			Pick<SocialGuildSettings, 'publicLeaderboard' | 'requiredXpBase' | 'requiredXpMultiplier'>[]
		>`
			SELECT public_leaderboard, required_xp_base, required_xp_multiplier
			FROM social_guild_settings WHERE guild_id = ${guildId}
		`;

		// A guild that never configured Social and one that deliberately keeps this off are indistinguishable
		// to a visitor, which is the point -- neither confirms anything about the guild.
		if (!settings?.publicLeaderboard) {
			throw notFound('Leaderboard not found');
		}

		const [page, guild] = await Promise.all([
			buildLeaderboardPage({ guildId, limit, offset, settings }),
			apiForGuild('SOCIAL', guildId)
				.guilds.get(guildId)
				.catch((error: unknown) => {
					req.logger.warn({ err: error, guildId }, 'failed to resolve guild for public leaderboard');
					return null;
				}),
		]);

		return {
			...page,
			guildIconUrl: guild?.icon
				? `${RouteBases.cdn}${CDNRoutes.guildIcon(guild.id, guild.icon, ImageFormat.PNG)}`
				: null,
			guildName: guild?.name ?? null,
			realtimeChannel: socialLeaderboardChannel(guildId),
		};
	},
});
