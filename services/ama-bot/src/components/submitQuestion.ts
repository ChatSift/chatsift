import type { Logger } from '@chatsift/backend-core';
import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import { amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIModalSubmitInteraction,
	APIMessageComponentInteraction,
	APIModalSubmitGuildInteraction,
} from '@discordjs/core';
import { TextInputStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { CurrentlyInQueue, postToAnswersChannel, postToQueue } from '../lib/queues.js';

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
				content: 'This AMA is no longer accepting new questions.',
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

		// `collectModal` resolves via its own listener in `@chatsift/bot-core`'s `lib/collector.ts`, bypassing the
		// normal dispatch path in `lib/client.ts` -- so the modal submission never gets its own per-interaction
		// logger from there. Passing the button click's `logger` through keeps the whole click -> modal -> post
		// flow under one `interactionId`,
		// which traces better than trying to key on the modal submission's own (separate) interaction id anyway.
		let modalInteraction: APIModalSubmitInteraction;
		try {
			modalInteraction = await collectModal(id, 5 * 60 * 1_000);
		} catch {
			// Timing out is a routine outcome (user opened the modal and never submitted it), not a bug --
			// letting the rejection propagate would crash the whole bot (it surfaces as an unhandled rejection
			// on the shared `InteractionCreate` listener in bot-core's `client.ts`, which has no 'error' handler).
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: "⌛ You didn't submit that in time. Click the button again when you're ready.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await this.handleModalCollected(modalInteraction as APIModalSubmitGuildInteraction, ama, logger);
	}

	private async handleModalCollected(interaction: APIModalSubmitGuildInteraction, ama: AmaSessions, logger: Logger) {
		await getContext().service.client.api.interactions.defer(interaction.id, interaction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const options = new ModalInteractionOptionResolver(interaction);

		const questionText = options.getTextInput('question-text');
		// The `file-upload` component only exists in the modal when uploads are allowed for this AMA (see
		// the conditional push above) -- calling `getAttachments` when it's absent throws.
		const attachments = ama.allowedQuestionUploads > 0 ? options.getAttachments('file-upload') : null;

		// Review's stage existence is keyed off `reviewEnabled`, not queue-channel truthiness -- it can be
		// dashboard-only (no Discord channel configured for it), see #293 follow-up / schema.sql.
		const state = ama.reviewEnabled ? 'PENDING_REVIEW' : ama.preparedAnswersEnabled ? 'APPROVED' : 'ASKED';
		// The only path that reaches 'ASKED' without an UPDATE, so `asked_at` is set right here rather than
		// alongside `answers_message_id` further down -- the row is already in its final state on insert.
		const [question] = await getContext().db<AmaQuestions[]>`
			INSERT INTO ama_questions (ama_id, author_id, content, state, asked_at)
			VALUES (${ama.id}, ${interaction.member.user.id}, ${questionText}, ${state}, ${state === 'ASKED' ? new Date() : null})
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
			if (ama.reviewEnabled) {
				// Posting the queue message is separate from the stage existing -- a dash-only-enabled stage
				// (no channel picked) has nothing to post, it just sits at PENDING_REVIEW for the dashboard.
				if (ama.queueId) {
					const msg = await postToQueue(postOptions);
					await getContext().db`
						UPDATE ama_questions SET queue_message_id = ${msg.id} WHERE id = ${question.id}
					`;

					logger.info(
						{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.queue },
						'Question submitted to queue',
					);
				} else {
					logger.info(
						{ questionId: question.id, amaId: ama.id },
						'Question submitted directly to review (dashboard-only, no queue channel configured)',
					);
				}
			} else if (ama.preparedAnswersEnabled) {
				// No review stage and prepared answers is on: hold at APPROVED, awaiting a prepared answer
				// and an explicit dashboard Send -- nothing auto-posts when this toggle is on (#293 follow-up).
				logger.info({ questionId: question.id, amaId: ama.id }, 'Question submitted directly to approved (held)');
			} else {
				// No queues configured and prepared answers off, post directly to answers channel (unchanged
				// prod behavior, now landing on ASKED instead of the old APPROVED).
				const msg = await postToAnswersChannel(postOptions);
				// `state` is already 'ASKED' from the INSERT above (this branch only runs when the computed
				// `state` fell through to 'ASKED') -- only the message id needs setting here.
				await getContext().db`
					UPDATE ama_questions SET answers_message_id = ${msg.id} WHERE id = ${question.id}
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
		} finally {
			// Published once the row has settled into its final shape (queue message id set, if any) rather
			// than right after the INSERT -- publishing earlier would race a dashboard refetch against the
			// UPDATE above and could deliver a stale `*_message_id`. Runs regardless of whether posting to
			// Discord succeeded: the row itself is already committed either way, and other dashboard clients
			// should still learn about it even if e.g. the queue post failed.
			await publishRealtimeInvalidate(amaQuestionsChannel(ama.guildId, ama.id));
		}
	}
}
