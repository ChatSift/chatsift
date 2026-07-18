import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AmaPromptData, AmaSessions } from '@chatsift/db';
import type {
	APIMessageComponentInteraction,
	APIMessageStringSelectInteractionData,
	RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core';
import { ButtonStyle, ComponentType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { ComponentHandler } from '../lib/components.js';

export default class AmaRepostSelectComponent implements ComponentHandler {
	public readonly name = 'ama-repost-select';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger) {
		const [rawId] = (interaction.data as APIMessageStringSelectInteractionData).values;
		const amaId = Number.parseInt(rawId!, 10);

		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		try {
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

			if (session.ended) {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: `**${session.title}** has already ended — its prompt won't be reposted.`,
					components: [],
				});
				return;
			}

			const [promptData] = await getContext().db<AmaPromptData[]>`
				SELECT * FROM ama_prompt_data WHERE ama_id = ${session.id}
			`;

			if (!promptData) {
				logger.error({ amaId: session.id }, 'AMA session has no prompt data row');
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: 'No prompt data is stored for that AMA. Please contact a developer.',
					components: [],
				});
				return;
			}

			// Mirrors services/api/src/routes/ama/repostPrompt.ts's guard: only repost if the original prompt message
			// is actually gone, so a mod can't end up with two live "Submit a question" buttons for the same AMA.
			// Only treat "the message is actually gone" (404 / Unknown Message) as messageExists = false — anything
			// else (missing permissions, rate limits, transport errors) is rethrown below so it surfaces as a real
			// failure instead of silently proceeding to create a duplicate prompt.
			let messageExists = false;
			try {
				await getContext().service.client.api.channels.getMessage(session.promptChannelId, promptData.promptMessageId);
				messageExists = true;
			} catch (error) {
				const isUnknownMessage =
					error instanceof DiscordAPIError &&
					(error.status === 404 || error.code === RESTJSONErrorCodes.UnknownMessage);

				if (!isUnknownMessage) {
					throw error;
				}

				messageExists = false;
			}

			if (messageExists) {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: `The prompt message for **${session.title}** still exists — delete it first if you want to repost.`,
					components: [],
				});
				return;
			}

			let messageBody: RESTPostAPIChannelMessageJSONBody;
			try {
				messageBody = JSON.parse(promptData.promptJsonData) as RESTPostAPIChannelMessageJSONBody;
			} catch (error) {
				logger.error({ err: error, amaId: session.id }, 'Failed to parse stored AMA prompt JSON data');
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: `**${session.title}**'s stored prompt data is corrupted. Please contact a developer.`,
					components: [],
				});
				return;
			}

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
				try {
					await getContext().service.client.api.channels.deleteMessage(session.promptChannelId, newPromptMessage.id);
				} catch (error) {
					// Best-effort: a stray message from a lost concurrent-repost race isn't worth failing over.
					logger.debug(
						{ error, channelId: session.promptChannelId, messageId: newPromptMessage.id },
						'Failed to clean up orphaned reposted prompt message',
					);
				}

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
		} catch (error) {
			logger.error({ error, amaId }, 'Failed to repost AMA prompt');
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'Failed to repost the prompt. Please try again.',
				components: [],
			});
		}
	}
}
