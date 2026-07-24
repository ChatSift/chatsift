import { getContext } from '@chatsift/backend-core';
import type { Blocks } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const bodySchema = z.strictObject({
	userId: snowflakeSchema,
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type DeleteBlockBody = z.input<typeof bodySchema>;

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/modmail/blocks',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { userId } = req.body;
		const { guildId } = req.params;

		const [deleted] = await getContext().db<Pick<Blocks, 'userId'>[]>`
			DELETE FROM blocks WHERE user_id = ${userId} AND guild_id = ${guildId}
			RETURNING user_id
		`;

		if (!deleted) {
			throw notFound('block not found for this user');
		}

		res.statusCode = 200;
		res.end();
	},
});
