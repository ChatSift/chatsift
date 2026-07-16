import type { AMASession } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type {
	APIModalSubmitInteraction,
	APIMessageComponentInteraction,
	APIModalSubmitGuildInteraction,
} from '@discordjs/core';
import { TextInputStyle, ComponentType, MessageFlags } from '@discordjs/core';
import type { Selectable } from 'kysely';
import { nanoid } from 'nanoid';
import { client } from '../lib/client.js';
import { collectModal } from '../lib/collector.js';
import type { ComponentHandler } from '../lib/components.js';
import { CurrentlyInQueue, postToAnswersChannel, postToGuestQueue, postToModQueue } from '../lib/queues.js';
import { ModalInteractionOptionResolver } from '../lib/resolvers/ModalInteractionOptionResolver.js';

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
				...(ama.allowedQuestionUploads > 0
					? [
							{
								type: ComponentType.Label,
								label: 'File upload (optional)',
								description: 'You may additionally upload images or files to accompany your question.',
								component: {
									type: ComponentType.FileUpload,
									custom_id: 'file-upload',
									required: false,
									min_values: 1,
									max_values: ama.allowedQuestionUploads,
								},
							} as const,
						]
					: []),
			],
		});

		const modalInteraction = await collectModal(id, 5 * 60 * 1_000);
		await this.handleModalCollected(modalInteraction as APIModalSubmitGuildInteraction, ama);
	}

	private async handleModalCollected(interaction: APIModalSubmitGuildInteraction, ama: Selectable<AMASession>) {
		await client.api.interactions.defer(interaction.id, interaction.token, { flags: MessageFlags.Ephemeral });

		const options = new ModalInteractionOptionResolver(interaction);

		const questionText = options.getTextInput('question-text');
		const attachments = options.getAttachments('file-upload');

		// Create the question in the database
		const question = await getContext()
			.db.insertInto('AMAQuestion')
			.values({
				amaId: ama.id,
				authorId: interaction.member.user.id,
				content: questionText,
				state: ama.modQueueId ? 'PENDING_MOD_REVIEW' : ama.guestQueueId ? 'PENDING_GUEST_REVIEW' : 'APPROVED',
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		// Determine where to post the question based on the AMA configuration
		const postOptions = {
			attachments: attachments ?? [],
			content: questionText,
			member: interaction.member,
			question,
			session: ama,
			user: interaction.member.user,
		};

		try {
			// Post to mod queue if configured, otherwise go straight to guest queue or answers channel
			if (ama.modQueueId) {
				const msg = await postToModQueue(postOptions);
				await getContext()
					.db.updateTable('AMAQuestion')
					.set({ modQueueMessageId: msg.id })
					.where('id', '=', question.id)
					.execute();
				getContext().logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.mod },
					'Question submitted to mod queue',
				);
			} else if (ama.guestQueueId) {
				const msg = await postToGuestQueue(postOptions);
				await getContext()
					.db.updateTable('AMAQuestion')
					.set({ guestQueueMessageId: msg.id })
					.where('id', '=', question.id)
					.execute();
				getContext().logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.guest },
					'Question submitted to guest queue',
				);
			} else {
				// No queues configured, post directly to answers channel
				const msg = await postToAnswersChannel(postOptions);
				await getContext()
					.db.updateTable('AMAQuestion')
					.set({ answersMessageId: msg.id, state: 'APPROVED' })
					.where('id', '=', question.id)
					.execute();
				getContext().logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.answers },
					'Question posted directly to answers channel',
				);
			}

			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: '✅ Your question has been submitted successfully!',
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			getContext().logger.error({ err: error, questionId: question.id, amaId: ama.id }, 'Failed to post question');

			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: '❌ Failed to submit your question. Please try again or contact a moderator.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
