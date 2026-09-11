import type { Logger } from '@chatsift/backend-core';
import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageTopLevelComponent } from '@discordjs/core';
import { ComponentType, MessageFlags } from '@discordjs/core';
import { moderationDecisions } from '../lib/metrics.js';
import { anonymousToggleButton } from '../lib/queues.js';

/**
 * Swaps the anonymity toggle on the live queue message for one showing the new state, leaving every other
 * button (and anything else on the message) exactly as it was -- rather than rebuilding the whole action row,
 * which would resurrect an Approve/Deny pair on a message whose row had since been replaced.
 */
function withUpdatedToggle(
	sourceComponents: APIMessageTopLevelComponent[] | undefined,
	question: AmaQuestions,
): APIMessageTopLevelComponent[] {
	return (sourceComponents ?? []).map((component) => {
		if (component.type !== ComponentType.ActionRow) {
			return component;
		}

		return {
			...component,
			components: component.components.map((child) =>
				child.type === ComponentType.Button &&
				'custom_id' in child &&
				child.custom_id === `toggle-anonymous:${question.id}`
					? anonymousToggleButton(question)
					: child,
			),
		};
	});
}

/**
 * Flips a question's `anonymous` flag straight from the queue (#366) -- the owner asked for this to be doable
 * without leaving Discord, since that's where the review actually happens.
 *
 * Only legal while nothing has been published: `PENDING_REVIEW`, and `APPROVED` (which only exists when
 * `prepared_answers_enabled` is on, i.e. the question is being held rather than posted). Once a question is
 * `ASKED` its answers-channel message is live and the flag can no longer be flipped without re-rendering
 * that message -- machinery that lives in `services/api`'s `updateQuestion.ts`, which the dashboard's own
 * toggle goes through. In practice the button is gone by then anyway: approving or denying replaces this
 * message's action row with a single disabled button.
 */
export default class ToggleAnonymousComponent implements ComponentHandler<string> {
	public readonly name = 'toggle-anonymous';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string, logger: Logger) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Ack within Discord's 3s window before any DB work, same as every other queue button here.
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		try {
			const [question] = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions WHERE id = ${questionId}
			`;

			if (!question) {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
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

			// Unreachable as things stand -- an umbrella question is created straight to 'APPROVED' with no queue
			// message, so this button is never drawn on one. Guarded anyway because the failure would be silent:
			// the UPDATE would succeed while every render kept hiding the author regardless (#366), leaving a row
			// that disagrees with what everyone can actually see.
			if (question.umbrella) {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: 'This is an umbrella question - it is never published with an author.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			// Guarded in the UPDATE itself rather than off the row read above, so two moderators clicking at the
			// same moment can't both flip from the same stale value -- and so an approve landing in between is
			// refused here instead of silently writing to a question that's since gone public.
			const [updated] = await getContext().db<AmaQuestions[]>`
				UPDATE ama_questions
				SET anonymous = ${!question.anonymous}, updated_at = now()
				WHERE id = ${questionId} AND anonymous = ${question.anonymous} AND state IN ('PENDING_REVIEW', 'APPROVED')
				RETURNING *
			`;

			if (!updated) {
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content:
						"Couldn't change this - the question has either already been posted, or someone else just toggled it. Use the dashboard to change an already-posted question.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			moderationDecisions.inc({ decision: 'anonymize', source: 'bot' });

			// The dashboard's question list only -- nothing is on the public answers page in either of the states
			// this route allows.
			await publishRealtimeInvalidate([amaQuestionsChannel(session.guildId, question.amaId)]);

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: withUpdatedToggle(interaction.message.components, updated),
			});

			logger.info(
				{ questionId, amaId: question.amaId, anonymous: updated.anonymous },
				'Toggled question anonymity from the queue',
			);
		} catch (error) {
			logger.error({ err: error, questionId }, 'Failed to toggle question anonymity');
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to update this question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
