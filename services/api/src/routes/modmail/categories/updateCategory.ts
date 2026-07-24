import { getContext } from '@chatsift/backend-core';
import type { Categories, CategoriesId } from '@chatsift/db';
import { conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { isUniqueViolation } from '../../../util/postgres.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateCategoryBodySchema } from '../schemas.js';

const bodySchema = updateCategoryBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	categoryId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as CategoriesId),
});

export type UpdateCategoryBody = z.input<typeof bodySchema>;
export type UpdateCategoryResult = Categories;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/modmail/categories/:categoryId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateCategoryResult> {
		const data = req.body;
		const { guildId, categoryId } = req.params;
		const db = getContext().db;

		const columns = Object.keys(data) as (keyof typeof data)[];

		try {
			const [category] = await db<Categories[]>`
				UPDATE categories
				SET ${db(data, ...columns)}
				WHERE id = ${categoryId} AND guild_id = ${guildId}
				RETURNING *
			`;

			if (!category) {
				throw notFound('category not found');
			}

			return category;
		} catch (error) {
			if (isUniqueViolation(error, 'categories_guild_id_name_key')) {
				throw conflict('a category with this name already exists', { conflictField: 'name' });
			}

			if (isUniqueViolation(error, 'categories_guild_id_forum_tag_id_key')) {
				throw conflict('a category is already routed to this forum tag', { conflictField: 'forumTagId' });
			}

			throw error;
		}
	},
});
