import { URL } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIMessageComponentInteraction,
	APIModalComponent,
	APIModalSubmitGuildInteraction,
	APIModalSubmitInteraction,
	APISelectMenuOption,
} from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags, TextInputStyle } from '@discordjs/core';
import { ModalInteractionOptionResolver, SnowflakeRegex } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';

/**
 * Discord's own hard cap on options per string select.
 */
const DISCORD_SELECT_OPTION_LIMIT = 25;

/**
 * Guest-queue counterpart to `guest-approve` for AMAs with `prepared_answers_enabled` on (#293
 * follow-up) — instead of posting to the answers channel immediately, this opens a modal (fields
 * mirroring prod `ChatSift/AMA`'s `add-answer.ts`) that prepares an answer ahead of time. Posting
 * only happens later, via the dashboard's Send action or the guest queue's own Send button.
 */
export default class GuestAddAnswerComponent implements ComponentHandler<string> {
	public readonly name = 'guest-add-answer';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string, logger: Logger) {
		const questionId = Number.parseInt(questionIdStr, 10);

		const [question] = await getContext().db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${questionId}
		`;

		if (!question) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
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

		// Once a guest list is configured for this AMA, "answered by" becomes a picker restricted to
		// those guests instead of a free-text user id (#293 follow-up, the dashboard applies the same
		// restriction in updateQuestion.ts). Empty list falls back to the original free-text behavior.
		const usesGuestSelect = session.guestIds.length > 0;
		const answeredByRow: APIModalComponent = usesGuestSelect
			? {
					type: ComponentType.Label,
					label: 'Answered by',
					description: 'Leave unselected to default to yourself.',
					component: {
						type: ComponentType.StringSelect,
						custom_id: 'answered-by-id',
						// Capped to Discord's own 25-option select limit, and built with no API calls -- a
						// modal must be shown within Discord's ~3s interaction response window, and resolving
						// every guest's display name first (N parallel `users.get` calls) risks blowing past it.
						// Falls back to the raw id as the label; the select's options are already restricted to
						// `session.guestIds`, so the id alone is still enough to pick unambiguously.
						options: buildGuestOptions(session.guestIds.slice(0, DISCORD_SELECT_OPTION_LIMIT)),
						min_values: 0,
						max_values: 1,
					},
				}
			: {
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'answered-by-id',
							type: ComponentType.TextInput,
							label: 'Answered by (user ID, optional)',
							style: TextInputStyle.Short,
							required: false,
						},
					],
				};

		const id = nanoid();
		await getContext().service.client.api.interactions.createModal(interaction.id, interaction.token, {
			custom_id: id,
			title: 'Add an answer',
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'answer-text',
							type: ComponentType.TextInput,
							label: 'Answer',
							max_length: 4_000,
							style: TextInputStyle.Paragraph,
							required: true,
						},
					],
				},
				{
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'answer-image-url',
							type: ComponentType.TextInput,
							label: 'Image URL (optional)',
							style: TextInputStyle.Short,
							required: false,
						},
					],
				},
				answeredByRow,
			],
		});

		let modalInteraction: APIModalSubmitInteraction;
		try {
			modalInteraction = await collectModal(id, 5 * 60 * 1_000);
		} catch {
			// Timing out is routine (the mod/guest opened the modal and never submitted) -- not a bug. See
			// submitQuestion.ts's identical handling for why this can't be allowed to propagate.
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: "⌛ You didn't submit that in time. Click the button again when you're ready.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await this.handleModalCollected(
			modalInteraction as APIModalSubmitGuildInteraction,
			questionId,
			interaction,
			usesGuestSelect,
			logger,
		);
	}

	private async handleModalCollected(
		modalInteraction: APIModalSubmitGuildInteraction,
		questionId: number,
		sourceInteraction: APIMessageComponentInteraction,
		usesGuestSelect: boolean,
		logger: Logger,
	) {
		await getContext().service.client.api.interactions.defer(modalInteraction.id, modalInteraction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const options = new ModalInteractionOptionResolver(modalInteraction);
		const answerText = options.getTextInput('answer-text');
		const answerImageUrl = options.getTextInput('answer-image-url') || null;

		if (answerImageUrl && !isHttpUrl(answerImageUrl)) {
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: '❌ "Image URL" must be a valid http(s) URL.' },
			);
			return;
		}

		// The select's options are already restricted to `session.guestIds`, so there's nothing further
		// to validate there -- the snowflake-format check only matters for the free-text fallback.
		const answeredByIdRaw = usesGuestSelect
			? (options.getSelectedStrings('answered-by-id')[0] ?? null)
			: options.getTextInput('answered-by-id') || null;

		if (!usesGuestSelect && answeredByIdRaw && !SnowflakeRegex.test(answeredByIdRaw)) {
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: '❌ "Answered by" must be a valid user ID.' },
			);
			return;
		}

		const answeredById = answeredByIdRaw ?? modalInteraction.member.user.id;

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

			const [session] = await getContext().db<AmaSessions[]>`
				SELECT * FROM ama_sessions WHERE id = ${question.amaId}
			`;

			if (session?.ended) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{ content: 'This AMA session has ended.' },
				);
				return;
			}

			// Re-checked against the freshly-reloaded guest list, not just the modal's own `usesGuestSelect`
			// branch decided at open time -- the guest list (or whether it's even configured at all) can
			// change between opening this modal and submitting it, which would otherwise let a stale
			// selection or a free-text id that's no longer a configured guest slip through unvalidated. The
			// implicit "leave unselected, default to yourself" path is exempt -- that's always allowed
			// regardless of the guest list.
			if (answeredByIdRaw && session && session.guestIds.length > 0 && !session.guestIds.includes(answeredByIdRaw)) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{
						content:
							'❌ "Answered by" must be one of this AMA\'s configured guests. The guest list may have changed since you opened this modal -- please try again.',
					},
				);
				return;
			}

			const [claimed] = await getContext().db<AmaQuestions[]>`
				UPDATE ama_questions
				SET state = 'APPROVED', answer_content = ${answerText}, answer_image_url = ${answerImageUrl},
					answered_by_id = ${answeredById}, answered_at = now(), updated_at = now()
				WHERE id = ${questionId} AND state = 'PENDING_GUEST_REVIEW'
				RETURNING *
			`;

			if (!claimed) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{ content: 'This question was already handled by someone else.' },
				);
				return;
			}

			// The button click that opened this modal was answered with the modal itself (not a deferred
			// update), so there's no "original interaction response" placeholder left to `editReply` --
			// the source queue message has to be patched directly via the channel instead.
			await getContext().service.client.api.channels.editMessage(
				sourceInteraction.channel_id!,
				sourceInteraction.message.id,
				{
					components: [
						{
							type: ComponentType.ActionRow,
							components: [
								{
									type: ComponentType.Button,
									style: ButtonStyle.Success,
									label: 'Send',
									custom_id: `send-question:${questionId}`,
								},
							],
						},
					],
				},
			);

			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: '✅ Answer prepared. Click "Send" on the message when you\'re ready to post it.' },
			);

			logger.info({ questionId, amaId: question.amaId }, 'Answer prepared for question');
		} catch (error) {
			logger.error({ err: error, questionId }, 'Failed to prepare answer for question');
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: 'Failed to prepare answer. Please try again.' },
			);
		}
	}
}

/**
 * Builds the guest select's options directly from the configured ids -- see the call site's comment
 * for why this deliberately doesn't resolve display names via the API at modal-creation time.
 */
function buildGuestOptions(guestIds: string[]): APISelectMenuOption[] {
	return guestIds.map((guestId) => ({ label: guestId, value: guestId }));
}

/**
 * Rejects anything that isn't an absolute http(s) URL -- this gets embedded directly as `image.url` in
 * the answer embed, so a `javascript:`/`data:`/malformed value shouldn't be allowed to reach Discord's
 * embed renderer unvalidated.
 */
function isHttpUrl(value: string): boolean {
	try {
		return ['http:', 'https:'].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}
