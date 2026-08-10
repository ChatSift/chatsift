import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import { MERGE_TARGET_STATES } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionState } from '@chatsift/db';
import type {
	APIMessageComponentInteraction,
	APIModalSubmitGuildInteraction,
	APIModalSubmitInteraction,
} from '@discordjs/core';
import { ComponentType, MessageFlags, TextInputStyle } from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';

// Phrased around what merging into that target actually does to it, rather than reusing the dashboard's
// own state labels ("Guest Questions"/"Asked Questions") -- in the queue the consequence is what a mod
// needs to weigh, and an ASKED target especially means editing a message the server has already seen.
const TARGET_STATE_DESCRIPTIONS: Partial<Record<AmaQuestionState, string>> = {
	PENDING_REVIEW: 'Still pending review',
	APPROVED: 'Approved - a guest is answering it',
	ASKED: 'Already posted publicly',
};

/**
 * Entry point for the duplicate-merge flow (#293 follow-up), available on the queue. Opens a modal to
 * search for the original question, then follows up with an ephemeral select of matches for
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

			// Scoped to the states a question can actually absorb a duplicate in (#328) -- which since that
			// issue includes APPROVED and ASKED, so a late duplicate can still be folded into a question a
			// guest is already answering, or one that's already been posted.
			const matches = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions
				WHERE ama_id = ${question.amaId} AND id != ${question.id} AND content ILIKE ${`%${query}%`}
					AND state = ANY(${[...MERGE_TARGET_STATES]})
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
									// The state is spelled out per option because targets are heterogeneous now (#328) --
									// picking an ASKED one edits an already-public post, which a mod has no other way
									// of telling apart from an ordinary pending question here.
									options: matches.map((match) => {
										const description = TARGET_STATE_DESCRIPTIONS[match.state];
										return {
											label: `#${match.id} - ${match.content.slice(0, 80)}`,
											value: String(match.id),
											...(description ? { description } : {}),
										};
									}),
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
