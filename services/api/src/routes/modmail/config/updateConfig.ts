import { getContext } from '@chatsift/backend-core';
import type { GuildSettings } from '@chatsift/db';
import { ChannelType } from '@discordjs/core';
import { badRequest, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { fetchGuildChannels } from '../../../util/channels.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { assertRolesBelongToGuild } from '../../../util/roles.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateConfigBodySchema } from '../schemas.js';

const bodySchema = updateConfigBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type UpdateModmailConfigBody = z.input<typeof bodySchema>;
export type UpdateModmailConfigResult = GuildSettings;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/modmail/config',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateModmailConfigResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		if (data.modForumId) {
			const channels = await fetchGuildChannels(guildId, discordAPIModmail);
			if (!channels) {
				req.logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
				throw internal();
			}

			const forumChannel = channels.find((channel) => channel.id === data.modForumId);
			if (!forumChannel) {
				throw badRequest(`channel ${data.modForumId} does not belong to this guild`);
			}

			if (forumChannel.type !== ChannelType.GuildForum) {
				throw badRequest('modForumId must point at a forum channel');
			}
		}

		if (data.alertRoleId) {
			await assertRolesBelongToGuild(guildId, [data.alertRoleId], discordAPIModmail, req.logger);
		}

		const columns = Object.keys(data) as (keyof typeof data)[];
		const [settings] = await db<GuildSettings[]>`
			INSERT INTO guild_settings (guild_id, mod_forum_id, default_greeting_message, farewell_message, simple_mode, alert_role_id)
			VALUES (
				${guildId}, ${data.modForumId ?? null}, ${data.defaultGreetingMessage ?? null},
				${data.farewellMessage ?? null}, ${data.simpleMode ?? false}, ${data.alertRoleId ?? null}
			)
			ON CONFLICT (guild_id) DO UPDATE SET ${db(data, ...columns)}
			RETURNING *
		`;

		return settings!;
	},
});
