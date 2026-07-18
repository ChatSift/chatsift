import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';

export default class ModDenyComponent implements ComponentHandler<string> {
	public readonly name = 'mod-deny';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Ack within Discord's 3s window before doing any DB/REST work below; everything past this point
		// finishes via editReply/followUp instead of reply/updateMessage.
		await client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		try {
			// Fetch the question to verify it exists
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

			// Only denies from PENDING_MOD_REVIEW so a concurrent approve/deny can't both win.
			const [denied] = await getContext().db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'DENIED', updated_at = now()
				WHERE id = ${question.id} AND state = 'PENDING_MOD_REVIEW'
				RETURNING *
			`;

			if (!denied) {
				await client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This question was already handled by another moderator.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			// Update the message to show it was denied
			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Danger,
								label: '❌ Denied',
								custom_id: 'denied-disabled',
								disabled: true,
							},
						],
					},
				],
			});

			getContext().logger.info({ questionId, amaId: question.amaId }, 'Question denied by moderator');
		} catch (error) {
			getContext().logger.error({ err: error, questionId }, 'Failed to deny question');
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to deny question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
