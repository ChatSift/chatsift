import { getContext } from '@chatsift/backend-core';
import { isUniqueViolation } from '@chatsift/db';
import type { SocialInteractions } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildInteractionCommandBody } from '../discordBodies.js';
import { createSocialInteractionBodySchema } from '../schemas.js';

const bodySchema = createSocialInteractionBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateSocialInteractionBody = z.input<typeof bodySchema>;
export type CreateSocialInteractionResult = SocialInteractions;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/social/interactions',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<CreateSocialInteractionResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		const [existing] = await db<Pick<SocialInteractions, 'id'>[]>`
			SELECT id FROM social_interactions WHERE guild_id = ${guildId} AND name = ${data.name}
		`;

		if (existing) {
			throw conflict('an interaction with this name already exists');
		}

		// The command has to exist on Discord's side before there's a commandId to store, and a name Discord
		// rejects (reserved, colliding with one of the bot's own global commands, ...) only surfaces here, not
		// at zod-validation time -- same ordering as modmail's `createSnippet.ts`.
		const applicationId = await getBotApplicationId('SOCIAL', guildId);
		const api = apiForGuild('SOCIAL', guildId);

		let command;
		try {
			command = await api.applicationCommands.createGuildCommand(
				applicationId,
				guildId,
				buildInteractionCommandBody(data.name, data.allowTargets),
			);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 400) {
				throw badData('not a valid Discord command name');
			}

			throw error;
		}

		try {
			const [interaction] = await db<SocialInteractions[]>`
				INSERT INTO social_interactions (
					guild_id, command_id, name, content, color, plain_content, attachment_url, embed, allow_targets
				)
				VALUES (
					${guildId},
					${command.id},
					${data.name},
					${data.content},
					${data.color ?? null},
					${data.plainContent ?? null},
					${data.attachmentUrl ?? null},
					${data.embed},
					${data.allowTargets}
				)
				RETURNING *
			`;

			return interaction!;
		} catch (error) {
			void (async () => {
				try {
					await api.applicationCommands.deleteGuildCommand(applicationId, guildId, command!.id);
				} catch (cleanupError) {
					req.logger.error({ err: cleanupError }, 'failed to clean up orphaned social interaction command');
				}
			})();

			// Race with a concurrent create of the same name that won the pre-check above -- the unique index is
			// the real guard, the SELECT is just an optimization to avoid registering a doomed command.
			if (isUniqueViolation(error, 'social_interactions_guild_id_name_key')) {
				throw conflict('an interaction with this name already exists');
			}

			throw error;
		}
	},
});
