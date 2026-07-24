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

		const [existing] = await db<Snippets[]>`
			SELECT * FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId}
		`;

		if (!existing) {
			throw notFound('snippet not found');
		}

		// Renamed here, outside the DB transaction/lock below -- holding a row lock (and a pooled connection) for
		// the duration of an external Discord HTTP call risks starving the connection pool if Discord is slow or
		// degraded, turning a Discord-side problem into a wider outage. The tradeoff: two concurrent renames of
		// the same snippet are no longer serialized against each other, but that's the same self-healing
		// reconciliation risk already accepted below for "the DB write fails after Discord already renamed" --
		// the next successful edit brings the two back in sync either way.
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

		try {
			return await db.begin(async (sql) => {
				const [current] = await sql<Snippets[]>`
					SELECT * FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId} FOR UPDATE
				`;

				if (!current) {
					throw notFound('snippet not found');
				}

				if (data.content !== undefined && data.content !== current.content) {
					await sql`
						INSERT INTO snippet_updates (snippet_id, updated_by, old_content)
						VALUES (${snippetId}, ${req.tokens!.access.sub}, ${current.content})
					`;
				}

				const [updated] = await sql<Snippets[]>`
					UPDATE snippets
					SET name = ${data.name ?? current.name}, content = ${data.content ?? current.content}, last_updated_at = now()
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
