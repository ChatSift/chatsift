import { randomBytes } from 'node:crypto';
import { getContext } from '@chatsift/backend-core';
import { DEFAULT_EMBED_COLOR } from '@chatsift/core';
import type { AmaSessions } from '@chatsift/db';
import type { RESTPostAPIChannelMessageJSONBody } from '@discordjs/core';
import { ButtonStyle, ComponentType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../util/channels.js';
import { discordAPIAma } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { createAMABodySchema } from './schemas.js';

const bodySchema = createAMABodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateAMABody = z.input<typeof bodySchema>;
export type CreateAMAResult = AmaSessions;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<CreateAMAResult> {
		const data = req.body;
		const { guildId } = req.params;

		let promptMessage: Awaited<ReturnType<typeof discordAPIAma.channels.createMessage>> | undefined;
		try {
			await assertChannelsBelongToGuild(
				guildId,
				[data.promptChannelId, data.answersChannelId, data.queueId],
				'AMA',
				req.logger,
			);

			const messageBodyBase: RESTPostAPIChannelMessageJSONBody =
				'prompt_raw' in data
					? data.prompt_raw
					: {
							content: data.prompt.plainText,
							embeds: [
								{
									color: data.prompt.color ?? DEFAULT_EMBED_COLOR,
									title: data.title,
									description: data.prompt.description,
									image: data.prompt.imageURL ? { url: data.prompt.imageURL } : undefined,
									thumbnail: data.prompt.thumbnailURL ? { url: data.prompt.thumbnailURL } : undefined,
									timestamp: new Date().toISOString(),
								},
							],
						};

			try {
				promptMessage = await discordAPIAma.channels.createMessage(data.promptChannelId, {
					...messageBodyBase,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									style: ButtonStyle.Primary,
									label: 'Submit a question',
									custom_id: 'submit-question',
								},
							],
						},
					],
				});
			} catch (error) {
				if (error instanceof DiscordAPIError && error.status === 400 && 'prompt_raw' in data) {
					throw badData('invalid prompt_raw data');
				}

				// The bot lacking permission to post in the chosen prompt channel is a correctable mistake (pick a
				// different channel, or fix the bot's permissions), not a server bug -- surface it as a 400 the
				// frontend can show verbatim instead of letting it fall through to a generic 500.
				if (
					error instanceof DiscordAPIError &&
					error.status === 403 &&
					(error.code === RESTJSONErrorCodes.MissingAccess || error.code === RESTJSONErrorCodes.MissingPermissions)
				) {
					throw badRequest('the bot is missing permissions to post in the selected prompt channel');
				}

				throw error;
			}

			// Backing the public read-only answers page (`/ama-answers/:shareToken`) -- generated unconditionally
			// at creation, not just for dash-only-queue AMAs (the owner asked for this on every AMA).
			const shareToken = randomBytes(24).toString('hex');

			return await getContext().db.begin(async (sql) => {
				const [session] = await sql<AmaSessions[]>`
					INSERT INTO ama_sessions (
						guild_id, title, answers_channel_id, prompt_channel_id,
						queue_id, allowed_question_uploads, ended, scheduled_close_at,
						review_enabled, prepared_answers_enabled, share_token, guest_ids
					)
					VALUES (
						${guildId}, ${data.title}, ${data.answersChannelId}, ${data.promptChannelId},
						${data.queueId}, ${data.allowedQuestionUploads}, false,
						${data.scheduledCloseAt ?? null},
						${data.reviewEnabled}, ${data.preparedAnswersEnabled}, ${shareToken}, ${sql.array(data.guestIds)}
					)
					RETURNING *
				`;

				await sql`
					INSERT INTO ama_prompt_data (ama_id, prompt_message_id, prompt_json_data)
					VALUES (${session!.id}, ${promptMessage!.id}, ${JSON.stringify(messageBodyBase)})
				`;

				return session!;
			});
		} catch (error) {
			// If we created the prompt message but failed to insert data, delete the message to avoid orphaned prompts.
			if (promptMessage) {
				// eslint-disable-next-line promise/prefer-await-to-then
				void discordAPIAma.channels.deleteMessage(data.promptChannelId, promptMessage.id).catch(() => null);
			}

			throw error;
		}
	},
});
