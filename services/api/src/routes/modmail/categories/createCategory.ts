import { getContext } from '@chatsift/backend-core';
import { isUniqueViolation } from '@chatsift/db';
import type { Categories, GuildSettings } from '@chatsift/db';
import { badRequest, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
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

		if (data.maxConcurrentThreads !== undefined && data.maxConcurrentThreads !== null) {
			const [guildSettings] = await getContext().db<GuildSettings[]>`
				SELECT max_concurrent_threads FROM guild_settings WHERE guild_id = ${guildId}
			`;

			const guildMax = guildSettings?.maxConcurrentThreads ?? 1;
			if (data.maxConcurrentThreads > guildMax) {
				throw badRequest(`maxConcurrentThreads cannot exceed the server's general limit (${guildMax})`, {
					conflictField: 'maxConcurrentThreads',
				});
			}
		}

		try {
			const [category] = await getContext().db<Categories[]>`
				INSERT INTO categories (
					guild_id, name, emoji, description, greeting_message, forum_tag_id, sort_order, max_concurrent_threads
				)
				VALUES (
					${guildId}, ${data.name}, ${data.emoji ?? null}, ${data.description ?? null},
					${data.greetingMessage ?? null}, ${data.forumTagId ?? null}, ${data.sortOrder}, ${data.maxConcurrentThreads ?? null}
				)
				RETURNING *
			`;

			return category!;
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
