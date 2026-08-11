import type { Logger } from '@chatsift/backend-core';
import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { fetchUser } from '@chatsift/bot-core';
import { amaPublicAnswersChannel, amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { countExtraAskers } from '../lib/askers.js';
import { claimAfterPost, postToAnswersChannel } from '../lib/queues.js';

export default class ModApproveComponent implements ComponentHandler<string> {
	public readonly name = 'mod-approve';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string, logger: Logger) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Ack within Discord's 3s window before doing any DB/REST work below; everything past this point
		// finishes via editReply/followUp instead of reply/updateMessage.
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		try {
			const [question] = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions WHERE id = ${questionId}
			`;

			if (!question) {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'Question not found. It may have been deleted.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			const [session] = await getContext().db<AmaSessions[]>`
				SELECT * FROM ama_sessions WHERE id = ${question.amaId}
			`;

			if (!session) {
				throw new Error(`No AMA session found for id ${question.amaId}`);
			}

			// No `session.ended` guard: closing an AMA only stops new submissions (#299) -- questions already in
			// the queue stay fully reviewable (and answerable) afterwards, which is the whole point of closing
			// rather than ending.

			// Get user details from the interaction -- cache-first (`fetchUser`), and in practice always a hit:
			// the author was primed into the shared cache when they submitted the question.
			const user = (await fetchUser(getContext().service.client.api, question.authorId)) ?? undefined;
			const member = interaction.guild_id
				? await getContext()
						.service.client.api.guilds.getMember(interaction.guild_id, question.authorId)
						.catch(() => undefined)
				: undefined;

			// Attachments aren't persisted on the row, so we carry them forward off the source message; the
			// question text itself comes straight from the DB (the source message's text has a footer baked in).
			const attachments = interaction.message.attachments ?? [];

			// Post first, claim second: if the post throws, the row is never touched and stays
			// PENDING_REVIEW, so the button remains retryable. Cleaning up the message we just posted when
			// the claim doesn't land is `claimAfterPost`'s job below, so this only reports.
			const notifyAlreadyHandled = async () =>
				getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already handled by another moderator.',
					flags: MessageFlags.Ephemeral,
				});

			if (session.preparedAnswersEnabled) {
				// Prepared answers is on: hold at APPROVED, awaiting a prepared answer and an explicit
				// dashboard Send (#293 follow-up) -- nothing posts here.
				const [claimed] = await getContext().db<AmaQuestions[]>`
					UPDATE ama_questions
					SET state = 'APPROVED', updated_at = now()
					WHERE id = ${question.id} AND state = 'PENDING_REVIEW'
					RETURNING *
				`;

				if (!claimed) {
					await notifyAlreadyHandled();
					return;
				}
			} else {
				// Duplicates can have been merged into this question while it sat in the queue, and this branch
				// posts it publicly without ever going through `buildQuestionEmbeds` -- so the count has to be
				// read here or the answers-channel post is the one place it silently goes missing (#326).
				const msg = await postToAnswersChannel({
					attachments,
					content: question.content,
					extraAskerCount: await countExtraAskers(getContext().db, question),
					logger,
					member,
					question,
					session,
					user,
				});

				// `null` back means a public-page-only AMA (#316): nothing was posted, so there's nothing for a
				// failed claim to clean up and the plain guarded UPDATE below is the whole transition.
				if (msg) {
					// Via `claimAfterPost` rather than a bare UPDATE: the message is already publicly visible at
					// this point, so a claim that *throws* has to clean it up just like one that comes back empty
					// (lost race) does -- otherwise a DB blip strands a question in the answers channel that no
					// row points at, and the still-PENDING_REVIEW button posts a second copy when retried.
					const claimed = await claimAfterPost<AmaQuestions>(
						async () => getContext().db<AmaQuestions[]>`
							UPDATE ama_questions
							SET state = 'ASKED', answers_message_id = ${msg.id}, asked_at = now(), updated_at = now()
							WHERE id = ${question.id} AND state = 'PENDING_REVIEW'
							RETURNING *
						`,
						async (channelId, messageId) =>
							getContext().service.client.api.channels.deleteMessage(channelId, messageId),
						// Off the message rather than `session.answersChannelId` (which is nullable since #316 and
						// would need an assertion here): this is the channel the post actually landed in, which is
						// what a compensating delete has to address anyway.
						msg.channel_id,
						msg.id,
						logger,
					);

					if (!claimed) {
						await notifyAlreadyHandled();
						return;
					}
				} else {
					const [claimed] = await getContext().db<AmaQuestions[]>`
						UPDATE ama_questions
						SET state = 'ASKED', asked_at = now(), updated_at = now()
						WHERE id = ${question.id} AND state = 'PENDING_REVIEW'
						RETURNING *
					`;

					if (!claimed) {
						await notifyAlreadyHandled();
						return;
					}
				}
			}

			// The public answers page too (#323): with `prepared_answers_enabled` off this approve posts
			// straight to the answers channel, and if an answer was already recorded from the dashboard
			// beforehand the question becomes publicly visible right here.
			await publishRealtimeInvalidate([
				amaQuestionsChannel(session.guildId, question.amaId),
				amaPublicAnswersChannel(question.amaId),
			]);

			// Update the message to show it was approved
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Success,
								label: '✅ Approved',
								custom_id: 'approved-disabled',
								disabled: true,
							},
						],
					},
				],
			});
		} catch (error) {
			logger.error({ err: error, questionId }, 'Failed to approve question');
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to approve question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
