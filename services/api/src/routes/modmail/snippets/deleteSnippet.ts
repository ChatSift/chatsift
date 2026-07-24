import { getContext } from '@chatsift/backend-core';
import type { Snippets, SnippetsId } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { getModmailApplicationId } from '../../../util/discordApplication.js';
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

		const [snippet] = await getContext().db<Pick<Snippets, 'commandId'>[]>`
			SELECT command_id FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId}
		`;

		if (!snippet) {
			throw notFound('snippet not found');
		}

		const applicationId = await getModmailApplicationId();

		try {
			await discordAPIModmail.applicationCommands.deleteGuildCommand(applicationId, guildId, snippet.commandId);
		} catch (error) {
			// Already gone on Discord's side (e.g. deleted out of band) -- fine, that's the state we want anyway.
			if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand)) {
				throw error;
			}
		}

		await getContext().db`
			DELETE FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId}
		`;

		res.statusCode = 200;
		res.end();
	},
});
