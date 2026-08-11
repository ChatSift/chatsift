import { getContext } from '@chatsift/backend-core';
import type { SocialInteractions, SocialInteractionsId } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { isUniqueViolation } from '../../../util/postgres.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { buildInteractionCommandBody } from '../discordBodies.js';
import { updateSocialInteractionBodySchema } from '../schemas.js';

const bodySchema = updateSocialInteractionBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	interactionId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as SocialInteractionsId),
});

export type UpdateSocialInteractionBody = z.input<typeof bodySchema>;
export type UpdateSocialInteractionResult = SocialInteractions;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/social/interactions/:interactionId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateSocialInteractionResult> {
		const data = req.body;
		const { guildId, interactionId } = req.params;
		const db = getContext().db;

		const [existing] = await db<SocialInteractions[]>`
			SELECT * FROM social_interactions WHERE id = ${interactionId} AND guild_id = ${guildId}
		`;

		if (!existing) {
			throw notFound('interaction not found');
		}

		const name = data.name ?? existing.name;
		const allowTargets = data.allowTargets ?? existing.allowTargets;
		// `color`/`plainContent`/`attachmentUrl` are `.nullable().optional()`: `undefined` (key omitted) means
		// "leave unchanged", an explicit `null` means "clear it", so they can't use the `??` fallback above.
		const color = data.color === undefined ? existing.color : data.color;
		const plainContent = data.plainContent === undefined ? existing.plainContent : data.plainContent;
		const attachmentUrl = data.attachmentUrl === undefined ? existing.attachmentUrl : data.attachmentUrl;

		// Same pre-check `createInteraction.ts` runs, for the same reason: without it a rename onto a taken name
		// edits the live Discord command first and only trips the unique index afterwards, leaving Discord's
		// copy renamed while the row keeps its old name. The index stays the real guard against the race.
		if (data.name !== undefined && data.name !== existing.name) {
			const [conflicting] = await db<Pick<SocialInteractions, 'id'>[]>`
				SELECT id FROM social_interactions
				WHERE guild_id = ${guildId} AND name = ${data.name} AND id != ${interactionId}
			`;

			if (conflicting) {
				throw conflict('an interaction with this name already exists');
			}
		}

		// Only the two fields baked into the Discord command itself need it re-issued. Done outside any
		// transaction: holding a row lock (and a pooled connection) across an external HTTP call risks
		// starving the pool whenever Discord is slow -- same reasoning as modmail's `updateSnippet.ts`.
		let commandId = existing.commandId;
		if (commandId && (data.name !== undefined || data.allowTargets !== undefined)) {
			const applicationId = await getBotApplicationId('SOCIAL', guildId);
			const api = apiForGuild('SOCIAL', guildId);

			try {
				// Compared against Discord's *live* command rather than the DB's copy of it, so an earlier edit
				// that renamed the command but failed to commit its DB write reconciles on any subsequent edit
				// instead of being permanently skipped as "no change" (see `updateSnippet.ts`'s longer note).
				const live = await api.applicationCommands.getGuildCommand(applicationId, guildId, commandId);
				const liveAllowsTargets = (live.options?.length ?? 0) > 0;

				if (live.name !== name || liveAllowsTargets !== allowTargets) {
					await api.applicationCommands.editGuildCommand(
						applicationId,
						guildId,
						commandId,
						buildInteractionCommandBody(name, allowTargets),
					);
				}
			} catch (error) {
				if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownApplicationCommand) {
					// The stored id no longer resolves under the application that currently owns this guild. Rather
					// than minting a replacement inline (which would duplicate resync's job in the one place it's
					// least testable), drop the id: the row falls back to name-based dispatch and shows up as
					// "needs a resync" on the dashboard, which is the same state every migrated row starts in.
					req.logger.warn(
						{ guildId, interactionId, commandId },
						'social interaction command no longer exists, clearing its id for resync',
					);
					commandId = null;
				} else if (error instanceof DiscordAPIError && error.status === 400) {
					throw badData('not a valid Discord command name');
				} else {
					throw error;
				}
			}
		}

		try {
			const [updated] = await db<SocialInteractions[]>`
				UPDATE social_interactions
				SET
					command_id = ${commandId},
					name = ${name},
					content = ${data.content ?? existing.content},
					color = ${color},
					plain_content = ${plainContent},
					attachment_url = ${attachmentUrl},
					embed = ${data.embed ?? existing.embed},
					allow_targets = ${allowTargets}
				WHERE id = ${interactionId} AND guild_id = ${guildId}
				RETURNING *
			`;

			return updated!;
		} catch (error) {
			if (isUniqueViolation(error, 'social_interactions_guild_id_name_key')) {
				throw conflict('an interaction with this name already exists');
			}

			throw error;
		}
	},
});
