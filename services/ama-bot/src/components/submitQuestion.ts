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
import { questionsSubmitted } from '../lib/metrics.js';
import { CurrentlyInQueue, postToAnswersChannel, postToQueue } from '../lib/queues.js';

function initialStateFor(ama: AmaSessions) {
	return ama.reviewEnabled ? 'PENDING_REVIEW' : ama.preparedAnswersEnabled ? 'APPROVED' : 'ASKED';
}

function capReachedMessage(limit: number): string {
	return limit === 1
		? 'You have already submitted a question to this AMA, and only one per person is allowed.'
		: `You have already submitted the maximum of ${limit} questions to this AMA.`;
}

export default class SubmitQuestionComponent implements ComponentHandler {
	public readonly name = 'submit-question';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger) {
		const [ama] = await getContext().db<AmaSessions[]>`
			SELECT s.* FROM ama_sessions s
			INNER JOIN ama_prompt_data p ON p.ama_id = s.id
			WHERE p.prompt_message_id = ${interaction.message.id}
		`;

		if (!ama) {
			logger.warn(
				{ promptMessageId: interaction.message.id },
				'submit-question clicked on a prompt with no AMA session (most likely a pre-cutover legacy prompt)',
			);
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content:
					"This prompt isn't linked to an active AMA - it's likely left over from before this server's AMA bot was upgraded. Ask a moderator to start a new AMA.",
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		// The guildId check is defense-in-depth against the join above ever resolving the wrong session again
		// (see #177) -- unlike the missing row above, this one should never happen, so it stays loud.
		if (ama.guildId !== interaction.guild_id) {
			logger.error(
				{ promptMessageId: interaction.message.id, amaId: ama.id, sessionGuildId: ama.guildId },
				'Prompt message resolved to an AMA session belonging to a different guild',
			);
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: "Something's wrong with this AMA prompt - please let a moderator know.",
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		if (ama.ended) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This AMA is no longer accepting new questions.',
				flags: MessageFlags.Ephemeral,
			});

			return;
		}

		if (ama.maxQuestionsPerUser !== null) {
			const asked = await this.countOwnQuestions(ama, interaction.member!.user.id);
			if (asked >= ama.maxQuestionsPerUser) {
				questionsSubmitted.inc({ initial_state: initialStateFor(ama).toLowerCase(), result: 'capped' });
				await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
					content: capReachedMessage(ama.maxQuestionsPerUser),
					flags: MessageFlags.Ephemeral,
				});

				return;
			}
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

	private async countOwnQuestions(ama: AmaSessions, userId: string): Promise<number> {
		const [row] = await getContext().db<[{ count: number }]>`
			SELECT COUNT(*)::int AS count FROM ama_questions
			WHERE ama_id = ${ama.id} AND author_id = ${userId}
		`;

		return row?.count ?? 0;
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

		const state = initialStateFor(ama);
		const authorId = interaction.member.user.id;
		const db = getContext().db;
		const [question] = await db<AmaQuestions[]>`
			INSERT INTO ama_questions (ama_id, author_id, content, state)
			SELECT ${ama.id}, ${authorId}, ${questionText}, ${state}
			${
				ama.maxQuestionsPerUser === null
					? db``
					: db`WHERE (
						SELECT COUNT(*) FROM ama_questions WHERE ama_id = ${ama.id} AND author_id = ${authorId}
					) < ${ama.maxQuestionsPerUser}`
			}
			RETURNING *
		`;

		if (!question) {
			// That WHERE is the only thing that can make this statement match zero rows, so an uncapped AMA
			// landing here is the genuinely-impossible write the throw covers, not somebody's cap.
			if (ama.maxQuestionsPerUser !== null) {
				questionsSubmitted.inc({ initial_state: state.toLowerCase(), result: 'capped' });
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: capReachedMessage(ama.maxQuestionsPerUser),
					flags: MessageFlags.Ephemeral,
				});

				return;
			}

			questionsSubmitted.inc({ initial_state: state.toLowerCase(), result: 'failed' });
			throw new Error(`Failed to insert question for AMA session ${ama.id}`);
		}

		// `initial_state` is the session's own config expressed as an outcome, so this counter doubles as
		// "how are guilds configured" in aggregate -- a deployment with `pending_review` flat at zero has no
		// guild running review at all, which is worth knowing before concluding the queue is broken.
		questionsSubmitted.inc({ initial_state: state.toLowerCase(), result: 'ok' });

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
				// prod behavior, now landing on ASKED instead of the old APPROVED). `null` back means this is a
				// public-page-only AMA (#316) with no answers channel to post to -- same "the stage exists, it
				// just has no Discord message" shape as the dash-only review branch above.
				const msg = await postToAnswersChannel(postOptions);
				// `state` is already 'ASKED' from the INSERT above (this branch only runs when the computed
				// `state` fell through to 'ASKED'), so only the message id and `asked_at` are set here.
				// `asked_at` deliberately lands *after* the post rather than in the INSERT: it means "when
				// this went out", and if `postToAnswersChannel` throws, the catch below leaves the row 'ASKED'
				// with neither an `answers_message_id` nor an `asked_at` -- which is exactly what a question
				// that never actually made it to the channel should look like. A skipped post still sets
				// `asked_at` (it did "go out", to the public page) but leaves the message id null.
				await getContext().db`
					UPDATE ama_questions
					SET answers_message_id = ${msg?.id ?? null}, asked_at = now()
					WHERE id = ${question.id}
				`;
				logger.info(
					{ questionId: question.id, amaId: ama.id, queue: CurrentlyInQueue.answers, posted: Boolean(msg) },
					msg ? 'Question posted directly to answers channel' : 'Question asked directly (public answers page only)',
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
