import { getContext } from '@chatsift/backend-core';
import type { SocialGuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { leaderboardQuerySchema } from '../schemas.js';
import type { LeaderboardPage } from './util.js';
import { buildLeaderboardPage } from './util.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListSocialLeaderboardResult = LeaderboardPage;

/**
 * The dashboard's ranked view of a guild's XP (redesign ledger item 5, shipped after P4). Manager-only, but
 * returning exactly what the unauthenticated route does -- see `buildLeaderboardPage`.
 *
 * A guild with no settings row at all still answers with an empty page rather than 404ing, matching
 * `getConfig.ts`: "Social was never configured here" is a state the dashboard renders, not an error.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/leaderboard',
	schema: {
		params: paramsSchema,
		query: leaderboardQuerySchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ListSocialLeaderboardResult> {
		const { guildId } = req.params;
		const { limit, offset } = req.query;

		const [settings] = await getContext().db<Pick<SocialGuildSettings, 'requiredXpBase' | 'requiredXpMultiplier'>[]>`
			SELECT required_xp_base, required_xp_multiplier FROM social_guild_settings WHERE guild_id = ${guildId}
		`;

		return buildLeaderboardPage({
			guildId,
			limit,
			offset,
			settings: settings ?? { requiredXpBase: null, requiredXpMultiplier: null },
		});
	},
});
