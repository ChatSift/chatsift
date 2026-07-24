import { getContext } from '@chatsift/backend-core';
import type { Snippets, SnippetsId } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { getModmailApplicationId } from '../../../util/discordApplication.js';
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

				// The row lock above holds for the rest of this transaction, so nothing else can rename this
				// snippet's command concurrently -- renaming it here, before the DB write, keeps the two in sync
				// on the success path (the only remaining risk is an unrelated failure rolling back the DB write
				// after Discord already renamed the command, which is an accepted, self-healing edge case: the
				// next successful edit brings them back in sync).
				if (data.name !== undefined && data.name !== existing.name) {
					const applicationId = await getModmailApplicationId();

					try {
						await discordAPIModmail.applicationCommands.editGuildCommand(applicationId, guildId, existing.commandId, {
							name: data.name,
						});
					} catch (error) {
						if (error instanceof DiscordAPIError && error.status === 400) {
							throw badData('not a valid Discord command name');
						}

						throw error;
					}
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
