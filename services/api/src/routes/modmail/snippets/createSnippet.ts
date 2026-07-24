import { getContext } from '@chatsift/backend-core';
import type { Snippets } from '@chatsift/db';
import type { RESTPostAPIApplicationGuildCommandsJSONBody } from '@discordjs/core';
import { ApplicationCommandOptionType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { getModmailApplicationId } from '../../../util/discordApplication.js';
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
		const db = getContext().db;

		const [existing] = await db<Pick<Snippets, 'id'>[]>`
			SELECT id FROM snippets WHERE guild_id = ${guildId} AND name = ${data.name}
		`;

		if (existing) {
			throw conflict('a snippet with this name already exists');
		}

		// Each snippet is registered as its own guild slash command (e.g. a snippet named `reportuser` is
		// invoked as `/reportuser`) rather than a subcommand of some shared `/snippet` command -- so it has to
		// exist on Discord's side before we have a commandId to store, and a name Discord rejects (reserved,
		// bad characters, etc.) only surfaces here, not at zod-validation time.
		const applicationId = await getModmailApplicationId();

		let command;
		try {
			const commandBody: RESTPostAPIApplicationGuildCommandsJSONBody = {
				name: data.name,
				description: 'ModMail snippet',
				default_member_permissions: '0',
				options: [
					{
						name: 'anon',
						description: 'Whether to send the reply anonymously -- defaults to false',
						type: ApplicationCommandOptionType.Boolean,
					},
				],
			};

			command = await discordAPIModmail.applicationCommands.createGuildCommand(applicationId, guildId, commandBody);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 400) {
				throw badData('not a valid Discord command name');
			}

			throw error;
		}

		try {
			const [snippet] = await db<Snippets[]>`
				INSERT INTO snippets (guild_id, command_id, created_by_id, name, content)
				VALUES (${guildId}, ${command.id}, ${req.tokens!.access.sub}, ${data.name}, ${data.content})
				RETURNING *
			`;

			return snippet!;
		} catch (error) {
			void (async () => {
				try {
					await discordAPIModmail.applicationCommands.deleteGuildCommand(applicationId, guildId, command!.id);
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
