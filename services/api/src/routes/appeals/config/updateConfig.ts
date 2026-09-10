import { getContext } from '@chatsift/backend-core';
import { appealsConfigChannel, DEFAULT_APPEAL_QUESTIONS } from '@chatsift/core';
import type { AppealQuestions, AppealsSettings } from '@chatsift/db';
import { ChannelType, PermissionFlagsBits } from '@discordjs/core';
import { badRequest, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { buildAppealLink } from '../../../util/appealLink.js';
import { assertBotHasChannelPermissions } from '../../../util/botPermissions.js';
import { fetchGuildChannels } from '../../../util/channels.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateAppealsConfigBodySchema } from '../schemas.js';
import type { GetAppealsConfigResult } from './getConfig.js';

const bodySchema = updateAppealsConfigBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * What the bot needs wherever appeals are posted: see the channel, post the one embed (decision 13), have that
 * embed render, and keep replying inside the thread or forum post afterwards.
 *
 * `CreatePublicThreads` is added for a text channel only -- on a forum, `SendMessages` *is* the create-a-post
 * permission, and requiring the thread permission there would reject a correctly-configured forum.
 */
const REQUIRED_MOD_CHANNEL_PERMISSIONS =
	PermissionFlagsBits.ViewChannel |
	PermissionFlagsBits.SendMessages |
	PermissionFlagsBits.SendMessagesInThreads |
	PermissionFlagsBits.EmbedLinks;

export type UpdateAppealsConfigBody = z.input<typeof bodySchema>;
export type UpdateAppealsConfigResult = GetAppealsConfigResult;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/appeals/config',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	realtimeChannel: (req) => appealsConfigChannel(req.params.guildId),
	async handler(req): Promise<UpdateAppealsConfigResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		if (data.modChannelId) {
			const channels = await fetchGuildChannels(guildId, 'APPEALS');
			if (!channels) {
				req.logger.warn({ guildId }, `Failed to fetch channels for guild ${guildId}`);
				throw internal();
			}

			const modChannel = channels.find((channel) => channel.id === data.modChannelId);
			if (!modChannel) {
				throw badRequest(`channel ${data.modChannelId} does not belong to this guild`);
			}

			if (modChannel.type !== ChannelType.GuildText && modChannel.type !== ChannelType.GuildForum) {
				throw badRequest('modChannelId must point at a text or forum channel');
			}

			await assertBotHasChannelPermissions(
				guildId,
				data.modChannelId,
				'APPEALS',
				modChannel.type === ChannelType.GuildText
					? REQUIRED_MOD_CHANNEL_PERMISSIONS | PermissionFlagsBits.CreatePublicThreads
					: REQUIRED_MOD_CHANNEL_PERMISSIONS,
				req.logger,
			);
		}

		const columns = Object.keys(data) as (keyof typeof data)[];

		return db.begin(async (tx) => {
			const [existing] = await tx<Pick<AppealsSettings, 'guildId'>[]>`
				SELECT guild_id FROM appeals_settings WHERE guild_id = ${guildId} FOR UPDATE
			`;

			// The one field with no defaultable value: without a mod channel there is nowhere to post an appeal,
			// so a guild's *first* save has to name one. Later saves are ordinary partial PATCHes.
			if (!existing && !data.modChannelId) {
				throw badRequest('modChannelId is required when configuring Appeals for the first time');
			}

			// An empty body is a PATCH that changes nothing, which is a legitimate no-op rather than an error --
			// but it cannot go through the upsert, because `tx(data)` with no columns renders an empty
			// `ON CONFLICT DO UPDATE SET` and postgres rejects that as a syntax error. Reading the row back keeps
			// the response shape identical, and the guard above has already rejected the only case where no row
			// exists to read. The questionnaire seeding below still runs, so an empty PATCH stays the way to
			// repair a guild whose questions went missing.
			const [settings] = columns.length
				? await tx<AppealsSettings[]>`
						INSERT INTO appeals_settings ${tx({ guildId, ...data }, 'guildId', ...columns)}
						ON CONFLICT (guild_id) DO UPDATE SET ${tx(data, ...columns)}
						RETURNING *
					`
				: await tx<AppealsSettings[]>`SELECT * FROM appeals_settings WHERE guild_id = ${guildId}`;

			// Seeded on the questionnaire being empty rather than on the settings row being new, so a guild that
			// somehow ends up with no questions (a hand-run DELETE, a half-applied P7 edit later) gets the default
			// set back instead of an appeal form with nothing on it. Idempotent either way.
			let questions = await tx<AppealQuestions[]>`
				SELECT * FROM appeal_questions WHERE guild_id = ${guildId} ORDER BY position ASC, id ASC
			`;

			if (questions.length === 0) {
				questions = await tx<AppealQuestions[]>`
					INSERT INTO appeal_questions ${tx(
						DEFAULT_APPEAL_QUESTIONS.map((question, position) => ({
							guildId,
							position,
							prompt: question.prompt,
							required: question.required,
						})),
					)}
					RETURNING *
				`;
			}

			// `createdAt` stripped so this answers the exact shape `getConfig` does -- the dashboard writes this
			// response straight into that query's cache, and a field present on one path but not the other is a
			// difference somebody would eventually have to explain.
			const { createdAt: _createdAt, ...rest } = settings!;
			// Unconditionally non-null here where `getConfig` has to check: a save that reaches this line wrote
			// the row, so the guild accepts appeals from this moment on.
			return { settings: rest, questions, appealLink: buildAppealLink(guildId) };
		});
	},
});
