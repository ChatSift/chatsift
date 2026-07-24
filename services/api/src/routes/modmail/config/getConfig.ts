import { getContext } from '@chatsift/backend-core';
import type { GuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetModmailConfigResult = GuildSettings;

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/config',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<GetModmailConfigResult> {
		const { guildId } = req.params;

		const [settings] = await getContext().db<GuildSettings[]>`
			SELECT * FROM guild_settings WHERE guild_id = ${guildId}
		`;

		// No row yet is the common case (a guild that hasn't configured ModMail) -- return the same shape a fresh
		// row would have instead of 404ing, so the dashboard config screen can render defaults on first load.
		return (
			settings ?? {
				guildId: guildId as GuildSettings['guildId'],
				modForumId: null,
				defaultGreetingMessage: null,
				farewellMessage: null,
				simpleMode: false,
				alertRoleId: null,
			}
		);
	},
});
