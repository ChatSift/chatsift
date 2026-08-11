import { getContext } from '@chatsift/backend-core';
import type { SocialInteractions, SocialInteractionsId } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	interactionId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as SocialInteractionsId),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/social/interactions/:interactionId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, interactionId } = req.params;

		const [interaction] = await getContext().db<Pick<SocialInteractions, 'commandId'>[]>`
			SELECT command_id FROM social_interactions WHERE id = ${interactionId} AND guild_id = ${guildId}
		`;

		if (!interaction) {
			throw notFound('interaction not found');
		}

		// `null` means the row was never registered under the current application (a migrated row awaiting its
		// first resync) -- there's nothing on Discord's side to delete, so go straight to the row.
		if (interaction.commandId) {
			const applicationId = await getBotApplicationId('SOCIAL', guildId);

			try {
				await apiForGuild('SOCIAL', guildId).applicationCommands.deleteGuildCommand(
					applicationId,
					guildId,
					interaction.commandId,
				);
			} catch (error) {
				// Already gone on Discord's side (deleted out of band, or belonging to a previous application) --
				// fine, that's the state we want anyway.
				if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand)) {
					throw error;
				}
			}
		}

		await getContext().db`
			DELETE FROM social_interactions WHERE id = ${interactionId} AND guild_id = ${guildId}
		`;

		res.statusCode = 200;
		res.end();
	},
});
