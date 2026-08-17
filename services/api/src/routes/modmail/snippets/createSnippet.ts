import { getContext } from '@chatsift/backend-core';
import { isUniqueViolation } from '@chatsift/db';
import type { Snippets } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildSnippetCommandBody } from '../discordBodies.js';
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
		const db = getContext().db;

		const [existing] = await db<Pick<Snippets, 'id'>[]>`
			SELECT id FROM snippets WHERE guild_id = ${guildId} AND name = ${data.name}
		`;

		if (existing) {
			throw conflict('a snippet with this name already exists');
		}

		// The snippet's guild command has to exist on Discord's side before we have a commandId to store, and a
		// name Discord rejects (reserved, bad characters, etc.) only surfaces here, not at zod-validation time.
		const applicationId = await getBotApplicationId('MODMAIL', guildId);
		const api = apiForGuild('MODMAIL', guildId);

		let command;
		try {
			command = await api.applicationCommands.createGuildCommand(
				applicationId,
				guildId,
				buildSnippetCommandBody(data.name),
			);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 400) {
				throw badData('not a valid Discord command name');
			}

			throw error;
		}

		try {
			const [snippet] = await db<Snippets[]>`
				INSERT INTO snippets (guild_id, command_id, created_by_id, name, content, attachment_url, attachment_filename)
				VALUES (
					${guildId},
					${command.id},
					${req.tokens.access.sub},
					${data.name},
					${data.content},
					${data.attachmentUrl ?? null},
					${data.attachmentFilename ?? null}
				)
				RETURNING *
			`;

			return snippet!;
		} catch (error) {
			void (async () => {
				try {
					await api.applicationCommands.deleteGuildCommand(applicationId, guildId, command!.id);
				} catch (cleanupError) {
					req.logger.error({ err: cleanupError }, 'failed to clean up orphaned snippet command');
				}
			})();

			// Race with a concurrent create of the same name that won the pre-check above -- the unique index
			// is the real guard, the SELECT above is just an optimization to avoid registering a doomed command.
			if (isUniqueViolation(error, 'snippets_guild_id_name_key')) {
				throw conflict('a snippet with this name already exists');
			}

			throw error;
		}
	},
});
