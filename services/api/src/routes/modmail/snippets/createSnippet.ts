import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';
import { conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { isUniqueViolation } from '../../../util/postgres.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { createSnippetBodySchema } from '../schemas.js';

const bodySchema = createSnippetBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateSnippetBody = z.input<typeof bodySchema>;
export type CreateSnippetResult = Snippets;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/modmail/snippets',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<CreateSnippetResult> {
		const data = req.body;
		const { guildId } = req.params;

		try {
			const [snippet] = await getContext().db<Snippets[]>`
				INSERT INTO snippets (guild_id, command_id, created_by_id, name, content)
				VALUES (${guildId}, ${data.commandId}, ${req.tokens!.access.sub}, ${data.name}, ${data.content})
				RETURNING *
			`;

			return snippet!;
		} catch (error) {
			if (isUniqueViolation(error, 'snippets_guild_id_name_key')) {
				throw conflict('a snippet with this name already exists');
			}

			throw error;
		}
	},
});
