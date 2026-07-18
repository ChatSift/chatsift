import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';
import { postToAnswersChannel } from '../lib/queues.js';

export default class GuestApproveComponent implements ComponentHandler<string> {
	public readonly name = 'guest-approve';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Ack within Discord's 3s window before doing any DB/REST work below; everything past this point
		// finishes via editReply/followUp instead of reply/updateMessage.
		await client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

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

		// Only claims from PENDING_GUEST_REVIEW so a concurrent answer/skip can't both win.
		const [claimed] = await getContext().db<AmaQuestions[]>`
			UPDATE ama_questions
			SET state = 'APPROVED', updated_at = now()
			WHERE id = ${question.id} AND state = 'PENDING_GUEST_REVIEW'
			RETURNING *
		`;

		if (!claimed) {
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'This question was already handled by someone else.',
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

		try {
			const msg = await postToAnswersChannel({
				attachments,
				content: question.content,
				member,
				question,
				session,
				user,
			});

			await getContext().db`
				UPDATE ama_questions SET answers_message_id = ${msg.id} WHERE id = ${question.id}
			`;

			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Success,
								label: '✅ Answered',
								custom_id: 'answered-disabled',
								disabled: true,
							},
						],
					},
				],
			});
		} catch (error) {
			// The row is already claimed (state flipped) at this point; if the answers-channel post itself
			// failed, the question is stuck claimed with no downstream message and needs manual follow-up —
			// logged loudly here rather than attempting a rollback/saga for what should be a rare failure mode.
			getContext().logger.error({ error, questionId }, 'Failed to approve question');
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to approve question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
