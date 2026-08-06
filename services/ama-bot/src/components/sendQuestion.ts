import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { getAnswerEmbed } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIEmbed, APIMessageComponentInteraction, APIUser } from '@discordjs/core';
import { ButtonStyle, CDNRoutes, ComponentType, ImageFormat, MessageFlags, RouteBases } from '@discordjs/core';
import { claimAfterPost } from '../lib/queues.js';

/**
 * Sends a prepared answer straight from the guest-queue message (#293 follow-up) -- lets a mod/guest
 * post it without switching over to the dashboard. Only reachable once `guestAddAnswer.ts` has set
 * `answer_content` and routed the question to `APPROVED`; the dashboard's own Send button
 * (`sendQuestion.ts` in `services/api`) does the equivalent thing for anyone who'd rather use that.
 */
export default class SendQuestionComponent implements ComponentHandler<string> {
	public readonly name = 'send-question';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string, logger: Logger) {
		const questionId = Number.parseInt(questionIdStr, 10);

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

			if (session.ended) {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This AMA session has ended.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (question.state !== 'APPROVED') {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already handled by someone else.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (!question.answerContent) {
				// This button only ever appears after `guestAddAnswer.ts` has set `answer_content` (see this
				// file's own doc comment) -- a missing answer here means the row got into an unexpected state,
				// not something to silently paper over with a non-null assertion.
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question has no prepared answer to send. Please prepare an answer first.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			let answeredByUser: APIUser | undefined;
			if (question.answeredById) {
				answeredByUser = await getContext()
					.service.client.api.users.get(question.answeredById)
					.catch(() => undefined);
			}

			const answeredByDisplayName =
				answeredByUser?.global_name ?? answeredByUser?.username ?? question.answeredById ?? 'Unknown User';
			const answeredByAvatarURL = answeredByUser?.avatar
				? `${RouteBases.cdn}${CDNRoutes.userAvatar(answeredByUser.id, answeredByUser.avatar, ImageFormat.PNG)}`
				: undefined;

			// The guest-queue message's own embeds are exactly what `postToGuestQueue` built via
			// `getBaseEmbeds` (same `includeUserId: false` as the answers channel), so they're reused
			// as-is instead of rebuilding the question embed(s) from scratch here.
			const embeds: APIEmbed[] = [
				...(interaction.message.embeds ?? []),
				getAnswerEmbed({
					answerContent: question.answerContent,
					answerImageUrl: question.answerImageUrl,
					answeredByAvatarURL,
					answeredByDisplayName,
				}),
			];

			const msg = await getContext().service.client.api.channels.createMessage(session.answersChannelId, {
				embeds,
			});

			const claimed = await claimAfterPost(
				async () => getContext().db<AmaQuestions[]>`
					UPDATE ama_questions
					SET state = 'ASKED', answers_message_id = ${msg.id}, updated_at = now()
					WHERE id = ${question.id} AND state = 'APPROVED'
					RETURNING *
				`,
				async (channelId, messageId) => getContext().service.client.api.channels.deleteMessage(channelId, messageId),
				session.answersChannelId,
				msg.id,
				logger,
			);

			if (!claimed) {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already sent.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Success,
								label: '✅ Sent',
								custom_id: 'sent-disabled',
								disabled: true,
							},
						],
					},
				],
			});

			logger.info({ questionId, amaId: question.amaId }, 'Question sent from guest queue');
		} catch (error) {
			logger.error({ err: error, questionId }, 'Failed to send question');
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to send question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
