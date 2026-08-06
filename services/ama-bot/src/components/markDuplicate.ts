import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import type { AmaQuestions } from '@chatsift/db';
import type {
	APIMessageComponentInteraction,
	APIModalSubmitGuildInteraction,
	APIModalSubmitInteraction,
} from '@discordjs/core';
import { ComponentType, MessageFlags, TextInputStyle } from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';

// Mirrors `services/api`'s own `MERGEABLE_STATES` -- a question that's already DENIED/FLAGGED/ASKED
// can't be picked as the original either (see `mergeQuestion.ts`'s matching validation), so it
// shouldn't show up as a selectable search result to begin with. Exported for `markDuplicateSelect.ts`
// to re-check at merge time, since a question's state can change between this search and that select.
export const MERGEABLE_STATES = new Set(['PENDING_MOD_REVIEW', 'PENDING_GUEST_REVIEW', 'APPROVED']);

/**
 * Entry point for the duplicate-merge flow (#293 follow-up), available on both the mod queue and
 * guest queue (not the flagged queue, which stays a read-only surface). Opens a modal to search for
 * the original question, then follows up with an ephemeral select of matches for
 * `markDuplicateSelect.ts` to act on.
 */
export default class MarkDuplicateComponent implements ComponentHandler<string> {
	public readonly name = 'mark-duplicate';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string, logger: Logger) {
		const id = nanoid();
		await getContext().service.client.api.interactions.createModal(interaction.id, interaction.token, {
			custom_id: id,
			title: 'Mark as duplicate',
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'search-query',
							type: ComponentType.TextInput,
							label: 'Search for the original question',
							style: TextInputStyle.Short,
							min_length: 1,
							max_length: 100,
							required: true,
						},
					],
				},
			],
		});

		let modalInteraction: APIModalSubmitInteraction;
		try {
			modalInteraction = await collectModal(id, 5 * 60 * 1_000);
		} catch {
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: "⌛ You didn't submit that in time. Click the button again when you're ready.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await this.handleModalCollected(modalInteraction as APIModalSubmitGuildInteraction, questionIdStr, logger);
	}

	private async handleModalCollected(
		modalInteraction: APIModalSubmitGuildInteraction,
		questionIdStr: string,
		logger: Logger,
	) {
		await getContext().service.client.api.interactions.defer(modalInteraction.id, modalInteraction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const questionId = Number.parseInt(questionIdStr, 10);
		const options = new ModalInteractionOptionResolver(modalInteraction);
		const query = options.getTextInput('search-query');

		try {
			const [question] = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions WHERE id = ${questionId}
			`;

			if (!question) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{ content: 'Question not found. It may have been deleted.' },
				);
				return;
			}

			const matches = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions
				WHERE ama_id = ${question.amaId} AND id != ${question.id} AND content ILIKE ${`%${query}%`}
					AND state = ANY(${[...MERGEABLE_STATES]})
				ORDER BY created_at DESC
				LIMIT 25
			`;

			if (matches.length === 0) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{ content: 'No matching questions found. Try a different search.' },
				);
				return;
			}

			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{
					content: `Select the original question that #${question.id} duplicates:`,
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.StringSelect,
									custom_id: `mark-duplicate-select:${question.id}`,
									placeholder: 'Select the original question',
									options: matches.map((match) => ({
										label: `#${match.id} - ${match.content.slice(0, 80)}`,
										value: String(match.id),
									})),
								},
							],
						},
					],
				},
			);
		} catch (error) {
			logger.error({ err: error, questionId }, 'Failed to search for duplicate candidates');
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: 'Failed to search for questions. Please try again.' },
			);
		}
	}
}
