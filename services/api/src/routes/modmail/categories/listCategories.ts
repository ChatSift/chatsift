import { getContext } from '@chatsift/backend-core';
import type { Categories } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/categories',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<Categories[]> {
		const { guildId } = req.params;

		return getContext().db<Categories[]>`
			SELECT * FROM categories WHERE guild_id = ${guildId} ORDER BY sort_order, id
		`;
	},
});
