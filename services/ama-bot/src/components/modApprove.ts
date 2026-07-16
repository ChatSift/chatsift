import { getContext } from '@chatsift/backend-core';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';
import { CurrentlyInQueue, getNextQueue, postToAnswersChannel, postToGuestQueue } from '../lib/queues.js';

export default class ModApproveComponent implements ComponentHandler {
	public readonly name = 'mod-approve';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Fetch the question and AMA session
		const question = await getContext()
			.db.selectFrom('AMAQuestion')
			.selectAll('AMAQuestion')
			.where('id', '=', questionId)
			.executeTakeFirst();

		if (!question) {
			await client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Question not found. It may have been deleted.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const session = await getContext()
			.db.selectFrom('AMASession')
			.selectAll()
			.where('id', '=', question.amaId)
			.executeTakeFirstOrThrow();

		if (session.ended) {
			await client.api.interactions.reply(interaction.id, interaction.token, {
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

		// Get the original message to extract attachments
		const originalMessage = interaction.message;
		const attachments = originalMessage.attachments ?? [];

		// Extract the question text from the container components
		let questionText = '';
		for (const component of originalMessage.components ?? []) {
			if (component.type === ComponentType.Container) {
				// Find the text display component in the container
				for (const section of component.components ?? []) {
					if (section.type === ComponentType.Section) {
						for (const textComponent of section.components ?? []) {
							if (textComponent.type === ComponentType.TextDisplay) {
								questionText = textComponent.content;
								break;
							}
						}
					}
				}
			}
		}

		// Determine the next queue
		const nextQueue = getNextQueue(CurrentlyInQueue.mod, session);

		try {
			if (nextQueue?.kind === CurrentlyInQueue.guest) {
				// Post to guest queue
				await postToGuestQueue({
					attachments,
					content: questionText,
					member,
					question,
					session,
					user,
				});
			} else {
				// Post directly to answers channel
				await postToAnswersChannel({
					attachments,
					content: questionText,
					member,
					question,
					session,
					user,
				});
			}

			// Update the message to show it was approved
			await client.api.interactions.updateMessage(interaction.id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: 3, // Success (green)
								label: '✅ Approved',
								custom_id: 'approved-disabled',
								disabled: true,
							},
						],
					},
				],
			});
		} catch (error) {
			getContext().logger.error({ error, questionId }, 'Failed to approve question');
			await client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Failed to approve question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
