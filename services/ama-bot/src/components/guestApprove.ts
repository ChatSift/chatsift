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
				UPDATE ama_questions
				SET state = 'APPROVED', answers_message_id = ${msg.id}, updated_at = now()
				WHERE id = ${question.id}
			`;

			await client.api.interactions.updateMessage(interaction.id, interaction.token, {
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
			getContext().logger.error({ error, questionId }, 'Failed to approve question');
			await client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'Failed to approve question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
