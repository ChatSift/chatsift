import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';
import {
	claimAfterPost,
	CurrentlyInQueue,
	getNextQueue,
	postToAnswersChannel,
	postToGuestQueue,
	withResolvedActionRow,
} from '../lib/queues.js';

export default class FlaggedApproveComponent implements ComponentHandler<string> {
	public readonly name = 'flagged-approve';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Ack within Discord's 3s window before doing any DB/REST work below; everything past this point
		// finishes via editReply/followUp instead of reply/updateMessage.
		await client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		try {
			const [question] = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions WHERE id = ${questionId}
			`;

			if (!question) {
				await client.api.interactions.followUp(interaction.application_id, interaction.token, {
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
				await client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This AMA session has ended.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			// Get user details from the interaction
			const user = await client.api.users.get(question.authorId);
			const member = interaction.guild_id
				? await client.api.guilds.getMember(interaction.guild_id, question.authorId).catch(() => undefined)
				: undefined;

			// Attachments aren't persisted on the row, so we carry them forward off the source message; the
			// question text itself comes straight from the DB (the source message's text has a footer baked in).
			const attachments = interaction.message.attachments ?? [];

			// A flag is a side-branch off the mod queue, so clearing it resumes the normal pipeline at the
			// stage that would've followed mod approval: guest queue if configured, otherwise straight to answers.
			const nextQueue = getNextQueue(CurrentlyInQueue.mod, session);

			// Post first, claim second: if the post throws, the row is never touched and stays FLAGGED, so
			// the button remains retryable. If we lose a claim race after posting (another moderator got
			// there first, or the session ended in the meantime), the just-posted message is cleaned up
			// instead of leaving a stray duplicate.
			let claimed: AmaQuestions | undefined;

			if (nextQueue?.kind === CurrentlyInQueue.guest) {
				const msg = await postToGuestQueue({
					attachments,
					content: question.content,
					member,
					question,
					session,
					user,
				});

				claimed = await claimAfterPost(
					async () => getContext().db<AmaQuestions[]>`
						UPDATE ama_questions
						SET state = 'PENDING_GUEST_REVIEW', guest_queue_message_id = ${msg.id}, updated_at = now()
						WHERE id = ${question.id}
							AND state = 'FLAGGED'
							AND EXISTS (SELECT 1 FROM ama_sessions s WHERE s.id = ama_questions.ama_id AND s.ended = false)
						RETURNING *
					`,
					async (channelId, messageId) => client.api.channels.deleteMessage(channelId, messageId),
					session.guestQueueId!,
					msg.id,
				);
			} else {
				const msg = await postToAnswersChannel({
					attachments,
					content: question.content,
					member,
					question,
					session,
					user,
				});

				claimed = await claimAfterPost(
					async () => getContext().db<AmaQuestions[]>`
						UPDATE ama_questions
						SET state = 'APPROVED', answers_message_id = ${msg.id}, updated_at = now()
						WHERE id = ${question.id}
							AND state = 'FLAGGED'
							AND EXISTS (SELECT 1 FROM ama_sessions s WHERE s.id = ama_questions.ama_id AND s.ended = false)
						RETURNING *
					`,
					async (channelId, messageId) => client.api.channels.deleteMessage(channelId, messageId),
					session.answersChannelId,
					msg.id,
				);
			}

			if (!claimed) {
				await client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already handled by another moderator.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			// Update the message to show it was approved, preserving the question container.
			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: withResolvedActionRow(interaction.message.components, {
					type: ComponentType.Button,
					style: ButtonStyle.Success,
					label: '✅ Approved',
					custom_id: 'approved-disabled',
					disabled: true,
				}),
			});

			getContext().logger.info({ questionId, amaId: question.amaId }, 'Flagged question approved by moderator');
		} catch (error) {
			getContext().logger.error({ error, questionId }, 'Failed to approve flagged question');
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to approve question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
