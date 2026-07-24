import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/snippets',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<Snippets[]> {
		const { guildId } = req.params;

		return getContext().db<Snippets[]>`
			SELECT * FROM snippets WHERE guild_id = ${guildId} ORDER BY name
		`;
	},
});
