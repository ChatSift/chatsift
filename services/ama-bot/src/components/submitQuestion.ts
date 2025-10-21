import type { AMASession } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { APIModalSubmitInteraction, APIMessageComponentInteraction } from '@discordjs/core';
import { TextInputStyle, ComponentType, MessageFlags } from '@discordjs/core';
import type { Selectable } from 'kysely';
import { nanoid } from 'nanoid';
import { client } from '../lib/client.js';
import { collectModal } from '../lib/collector.js';
import type { ComponentHandler } from '../lib/components.js';

export default class SubmitQuestionComponent implements ComponentHandler {
	public readonly name = 'submit-question';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction) {
		const ama = await getContext()
			.db.selectFrom('AMASession')
			.selectAll('AMASession')
			.innerJoin('AMAPromptData', 'AMASession.id', 'AMAPromptData.id')
			.where('AMAPromptData.promptMessageId', '=', interaction.message.id)
			.executeTakeFirstOrThrow();

		if (ama.ended) {
			await client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This AMA session has ended. You can no longer submit questions.',
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		const id = nanoid();
		await client.api.interactions.createModal(interaction.id, interaction.token, {
			custom_id: id,
			title: 'Submit a question',
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'question-text',
							type: ComponentType.TextInput,
							label: 'Your question',
							min_length: 15,
							max_length: 4_000,
							style: TextInputStyle.Paragraph,
							required: true,
						},
					],
				},
				{
					type: ComponentType.Label,
					label: 'File upload (optional)',
					description: 'You may additionally upload images or files to accompany your question.',
					component: {
						type: ComponentType.FileUpload,
						custom_id: 'file-upload',
						required: false,
						min_values: 1,
						max_values: 10,
					},
				},
			],
		});

		const modalInteraction = await collectModal(id, 5 * 60 * 1_000);
		await this.handleModalCollected(modalInteraction, ama);
	}

	private async handleModalCollected(interaction: APIModalSubmitInteraction, ama: Selectable<AMASession>) {
		return client.api.interactions.reply(interaction.id, interaction.token, {
			content: ':)',
			flags: MessageFlags.Ephemeral,
		});
	}
}
