import { getContext } from '@chatsift/backend-core';
import type { Snippets, SnippetsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	snippetId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as SnippetsId),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/modmail/snippets/:snippetId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, snippetId } = req.params;

		const [deleted] = await getContext().db<Pick<Snippets, 'id'>[]>`
			DELETE FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId}
			RETURNING id
		`;

		if (!deleted) {
			throw notFound('snippet not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
