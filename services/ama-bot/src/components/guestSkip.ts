import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';

export default class GuestSkipComponent implements ComponentHandler<string> {
	public readonly name = 'guest-skip';

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

		try {
			// Only skips from PENDING_GUEST_REVIEW so a concurrent answer/skip can't both win.
			const [skipped] = await getContext().db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'DENIED', updated_at = now()
				WHERE id = ${question.id} AND state = 'PENDING_GUEST_REVIEW'
				RETURNING *
			`;

			if (!skipped) {
				await client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already handled by someone else.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Secondary,
								label: '⏭️ Skipped',
								custom_id: 'skipped-disabled',
								disabled: true,
							},
						],
					},
				],
			});

			getContext().logger.info({ questionId, amaId: question.amaId }, 'Question skipped by guest');
		} catch (error) {
			getContext().logger.error({ err: error, questionId }, 'Failed to skip question');
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to skip question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
