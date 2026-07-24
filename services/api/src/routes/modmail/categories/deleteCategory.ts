import { getContext } from '@chatsift/backend-core';
import type { Categories, CategoriesId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	categoryId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as CategoriesId),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/modmail/categories/:categoryId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, categoryId } = req.params;

		const [deleted] = await getContext().db<Pick<Categories, 'id'>[]>`
			DELETE FROM categories WHERE id = ${categoryId} AND guild_id = ${guildId}
			RETURNING id
		`;

		if (!deleted) {
			throw notFound('category not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
