import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';
import { postToFlaggedQueue } from '../lib/queues.js';

export default class ModFlagComponent implements ComponentHandler<string> {
	public readonly name = 'mod-flag';

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

			const user = await client.api.users.get(question.authorId);
			const member = interaction.guild_id
				? await client.api.guilds.getMember(interaction.guild_id, question.authorId).catch(() => undefined)
				: undefined;

			// Attachments aren't persisted on the row, so we carry them forward off the source message; the
			// question text itself comes straight from the DB (the source message's text has a footer baked in).
			const attachments = interaction.message.attachments ?? [];

			// Post first, claim second: if the post throws, the row is never touched and stays
			// PENDING_MOD_REVIEW, so the button remains retryable. If we lose a claim race after posting
			// (another moderator got there first), we clean up the message we just created instead of
			// leaving a stray duplicate.
			const msg = await postToFlaggedQueue({
				attachments,
				content: question.content,
				member,
				question,
				session,
				user,
			});

			const [claimed] = await getContext().db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'FLAGGED', flagged_queue_message_id = ${msg.id}, updated_at = now()
				WHERE id = ${question.id} AND state = 'PENDING_MOD_REVIEW'
				RETURNING *
			`;

			if (!claimed) {
				// eslint-disable-next-line promise/prefer-await-to-then
				void client.api.channels.deleteMessage(session.flaggedQueueId!, msg.id).catch(() => null);
				await client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already handled by another moderator.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			// Update the message to show it was flagged
			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Secondary,
								label: '⚠️ Flagged',
								custom_id: 'flagged-disabled',
								disabled: true,
							},
						],
					},
				],
			});

			getContext().logger.info({ questionId, amaId: question.amaId }, 'Question flagged by moderator');
		} catch (error) {
			getContext().logger.error({ error, questionId }, 'Failed to flag question');
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to flag question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
