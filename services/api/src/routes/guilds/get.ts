import { BOTS, GRANTS } from '@chatsift/backend-core';
import { notFound } from '@hapi/boom';
import z from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { fetchGuildChannels, type GuildChannelInfo } from '../../util/channels.js';
import { APIMapping } from '../../util/discordAPI.js';
import { fetchGuildEmojis, type GuildEmojiInfo } from '../../util/emojis.js';
import { fetchGuildRoles, type GuildRoleInfo } from '../../util/roles.js';
import { queryWithFreshSchema, snowflakeSchema } from '../../util/schemas.js';

export type { GuildChannelInfo, PossiblyMissingChannelInfo } from '../../util/channels.js';
export type { GuildEmojiInfo } from '../../util/emojis.js';
export type { GuildRoleInfo } from '../../util/roles.js';

const querySchema = queryWithFreshSchema.safeExtend({
	for_bot: z.enum(BOTS),
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetGuildQuery = z.input<typeof querySchema>;

export interface GetGuildResult {
	channels: GuildChannelInfo[];
	emojis: GuildEmojiInfo[];
	roles: GuildRoleInfo[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
		grants: [GRANTS.AMA_CREATE],
	}),
	async handler(req): Promise<GetGuildResult> {
		const { guildId } = req.params;
		const { force_fresh, for_bot } = req.query;

		const [channels, roles, emojis] = await Promise.all([
			fetchGuildChannels(guildId, APIMapping[for_bot], force_fresh),
			fetchGuildRoles(guildId, APIMapping[for_bot], force_fresh),
			fetchGuildEmojis(guildId, APIMapping[for_bot], force_fresh),
		]);

		if (!channels || !roles || !emojis) {
			throw notFound('guild not found or bot not in guild');
		}

		return { channels, roles, emojis };
	},
});
