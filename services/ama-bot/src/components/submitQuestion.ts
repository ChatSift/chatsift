import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIModalSubmitInteraction,
	APIMessageComponentInteraction,
	APIModalSubmitGuildInteraction,
} from '@discordjs/core';
import { TextInputStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { collectModal } from '../lib/collector.js';
import type { ComponentHandler } from '../lib/components.js';
import { CurrentlyInQueue, postToAnswersChannel, postToGuestQueue, postToModQueue } from '../lib/queues.js';

export default class SubmitQuestionComponent implements ComponentHandler {
	public readonly name = 'submit-question';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger) {
		const [ama] = await getContext().db<AmaSessions[]>`
			SELECT s.* FROM ama_sessions s
			INNER JOIN ama_prompt_data p ON p.ama_id = s.id
			WHERE p.prompt_message_id = ${interaction.message.id}
		`;

		// The guildId check is defense-in-depth against the join above ever resolving the wrong session again
		// (see #177) -- it should never actually diverge from the prompt message's own guild.
		if (!ama || ama.guildId !== interaction.guild_id) {
			throw new Error(`No AMA session found for prompt message ${interaction.message.id}`);
		}

		if (ama.ended) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This AMA session has ended. You can no longer submit questions.',
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		const id = nanoid();
		await getContext().service.client.api.interactions.createModal(interaction.id, interaction.token, {
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

		// `collectModal` resolves via its own listener in `lib/collector.ts`, bypassing the normal dispatch path
		// in `client.ts` -- so the modal submission never gets its own per-interaction logger from there. Passing
		// the button click's `logger` through keeps the whole click -> modal -> post flow under one `interactionId`,
		// which traces better than trying to key on the modal submission's own (separate) interaction id anyway.
		const modalInteraction = await collectModal(id, 5 * 60 * 1_000);
		await this.handleModalCollected(modalInteraction as APIModalSubmitGuildInteraction, ama, logger);
	}

	private async handleModalCollected(interaction: APIModalSubmitGuildInteraction, ama: AmaSessions, logger: Logger) {
		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const options = new ModalInteractionOptionResolver(interaction);

		const questionText = options.getTextInput('question-text');
		const attachments = options.getAttachments('file-upload');

		// Create the question in the database
		const state = ama.modQueueId ? 'PENDING_MOD_REVIEW' : ama.guestQueueId ? 'PENDING_GUEST_REVIEW' : 'APPROVED';
		const [question] = await getContext().db<AmaQuestions[]>`
			INSERT INTO ama_questions (ama_id, author_id, content, state)
			VALUES (${ama.id}, ${interaction.member.user.id}, ${questionText}, ${state})
			RETURNING *
		`;

		if (!question) {
			throw new Error(`Failed to insert question for AMA session ${ama.id}`);
		}

		// Determine where to post the question based on the AMA configuration
		const postOptions = {
			attachments: attachments ?? [],
			content: questionText,
			logger,
			member: interaction.member,
			question,
			session: ama,
			user: interaction.member.user,
		};

		try {
			// Post to mod queue if configured, otherwise go straight to guest queue or answers channel
			if (ama.modQueueId) {
				const msg = await postToModQueue(postOptions);
				await getContext().db`
					UPDATE ama_questions SET mod_queue_message_id = ${msg.id} WHERE id = ${question.id}
				`;
				logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.mod },
					'Question submitted to mod queue',
				);
			} else if (ama.guestQueueId) {
				const msg = await postToGuestQueue(postOptions);
				await getContext().db`
					UPDATE ama_questions SET guest_queue_message_id = ${msg.id} WHERE id = ${question.id}
				`;
				logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.guest },
					'Question submitted to guest queue',
				);
			} else {
				// No queues configured, post directly to answers channel
				const msg = await postToAnswersChannel(postOptions);
				await getContext().db`
					UPDATE ama_questions SET answers_message_id = ${msg.id}, state = 'APPROVED' WHERE id = ${question.id}
				`;
				logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.answers },
					'Question posted directly to answers channel',
				);
			}

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: '✅ Your question has been submitted successfully!',
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			logger.error({ err: error, questionId: question.id, amaId: ama.id }, 'Failed to post question');

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: '❌ Failed to submit your question. Please try again or contact a moderator.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
