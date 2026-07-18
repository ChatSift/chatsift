import { getContext } from '@chatsift/backend-core';
import type { AmaPromptData, AmaSessions } from '@chatsift/db';
import type {
	APIMessageComponentInteraction,
	APIMessageStringSelectInteractionData,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { ButtonStyle, ComponentType } from '@discordjs/core';
import type { ComponentHandler } from '../lib/components.js';

export default class AmaRepostSelectComponent implements ComponentHandler {
	public readonly name = 'ama-repost-select';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction) {
		const [rawId] = (interaction.data as APIMessageStringSelectInteractionData).values;
		const amaId = Number.parseInt(rawId!, 10);

		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const [session] = await getContext().db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE id = ${amaId}
		`;

		if (!session || session.guildId !== interaction.guild_id) {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'That AMA could not be found.',
				components: [],
			});
			return;
		}

		const [promptData] = await getContext().db<AmaPromptData[]>`
			SELECT * FROM ama_prompt_data WHERE ama_id = ${session.id}
		`;

		if (!promptData) {
			getContext().logger.error({ amaId: session.id }, 'AMA session has no prompt data row');
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'No prompt data is stored for that AMA. Please contact a developer.',
				components: [],
			});
			return;
		}

		// Mirrors services/api/src/routes/ama/repostPrompt.ts's guard: only repost if the original prompt message
		// is actually gone, so a mod can't end up with two live "Submit a question" buttons for the same AMA.
		let messageExists = false;
		try {
			await getContext().service.client.api.channels.getMessage(session.promptChannelId, promptData.promptMessageId);
			messageExists = true;
		} catch {
			messageExists = false;
		}

		if (messageExists) {
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `The prompt message for **${session.title}** still exists — delete it first if you want to repost.`,
				components: [],
			});
			return;
		}

		const messageBody = JSON.parse(promptData.promptJsonData) as RESTPostAPIChannelMessageJSONBody;

		const newPromptMessage = await getContext().service.client.api.channels.createMessage(session.promptChannelId, {
			...messageBody,
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

		// Conditional on the prompt_message_id we actually read above — if a concurrent repost (e.g. from the
		// dashboard's repost action) already changed it, this affects zero rows instead of silently overwriting it.
		const updateResult = await getContext().db`
			UPDATE ama_prompt_data
			SET prompt_message_id = ${newPromptMessage.id}
			WHERE ama_id = ${session.id} AND prompt_message_id = ${promptData.promptMessageId}
		`;

		if (updateResult.count === 0) {
			// eslint-disable-next-line promise/prefer-await-to-then
			void getContext().service.client.api.channels.deleteMessage(session.promptChannelId, newPromptMessage.id).catch(() => null);

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `**${session.title}**'s prompt was already reposted elsewhere.`,
				components: [],
			});
			return;
		}

		await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
			content: `Reposted the prompt for **${session.title}**.`,
			components: [],
		});
	}
}
