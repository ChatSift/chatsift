import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';

export default class ModDenyComponent implements ComponentHandler {
	public readonly name = 'mod-deny';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Fetch the question to verify it exists
		const [question] = await getContext().db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${questionId}
		`;

		if (!question) {
			await client.api.interactions.reply(interaction.id, interaction.token, {
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
			await client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This AMA session has ended.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			// Update the message to show it was denied
			await client.api.interactions.updateMessage(interaction.id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: 4, // Danger (red)
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
			await client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Failed to deny question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
