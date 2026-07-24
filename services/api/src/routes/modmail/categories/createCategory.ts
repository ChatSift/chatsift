import { getContext } from '@chatsift/backend-core';
import type { Categories } from '@chatsift/db';
import { conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { isUniqueViolation } from '../../../util/postgres.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { createCategoryBodySchema } from '../schemas.js';

const bodySchema = createCategoryBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateCategoryBody = z.input<typeof bodySchema>;
export type CreateCategoryResult = Categories;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/categories',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<CreateCategoryResult> {
		const data = req.body;
		const { guildId } = req.params;

		try {
			const [category] = await getContext().db<Categories[]>`
				INSERT INTO categories (guild_id, name, emoji, description, greeting_message, forum_tag_id, sort_order)
				VALUES (
					${guildId}, ${data.name}, ${data.emoji ?? null}, ${data.description ?? null},
					${data.greetingMessage ?? null}, ${data.forumTagId ?? null}, ${data.sortOrder}
				)
				RETURNING *
			`;

			return category!;
		} catch (error) {
			if (isUniqueViolation(error, 'categories_guild_id_name_key')) {
				throw conflict('a category with this name already exists');
			}

			if (isUniqueViolation(error, 'categories_guild_id_forum_tag_id_key')) {
				throw conflict('a category is already routed to this forum tag');
			}

			throw error;
		}
	},
});
