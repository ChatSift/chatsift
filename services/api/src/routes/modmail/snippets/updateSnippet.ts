import { getContext } from '@chatsift/backend-core';
import type { Snippets, SnippetsId } from '@chatsift/db';
import { conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { isUniqueViolation } from '../../../util/postgres.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateSnippetBodySchema } from '../schemas.js';

const bodySchema = updateSnippetBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	snippetId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as SnippetsId),
});

export type UpdateSnippetBody = z.input<typeof bodySchema>;
export type UpdateSnippetResult = Snippets;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/modmail/snippets/:snippetId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateSnippetResult> {
		const data = req.body;
		const { guildId, snippetId } = req.params;
		const db = getContext().db;

		try {
			return await db.begin(async (sql) => {
				const [existing] = await sql<Snippets[]>`
					SELECT * FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId} FOR UPDATE
				`;

				if (!existing) {
					throw notFound('snippet not found');
				}

				if (data.content !== undefined && data.content !== existing.content) {
					await sql`
						INSERT INTO snippet_updates (snippet_id, updated_by, old_content)
						VALUES (${snippetId}, ${req.tokens!.access.sub}, ${existing.content})
					`;
				}

				const [updated] = await sql<Snippets[]>`
					UPDATE snippets
					SET name = ${data.name ?? existing.name}, content = ${data.content ?? existing.content}, last_updated_at = now()
					WHERE id = ${snippetId}
					RETURNING *
				`;

				return updated!;
			});
		} catch (error) {
			if (isUniqueViolation(error, 'snippets_guild_id_name_key')) {
				throw conflict('a snippet with this name already exists');
			}

			throw error;
		}
	},
});
