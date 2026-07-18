import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction } from '@discordjs/core';
import { ButtonStyle, ComponentType, MessageFlags } from '@discordjs/core';
import { client } from '../lib/client.js';
import type { ComponentHandler } from '../lib/components.js';
import { CurrentlyInQueue, getNextQueue, postToAnswersChannel, postToGuestQueue } from '../lib/queues.js';

export default class ModApproveComponent implements ComponentHandler<string> {
	public readonly name = 'mod-approve';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, questionIdStr: string) {
		const questionId = Number.parseInt(questionIdStr, 10);

		// Ack within Discord's 3s window before doing any DB/REST work below; everything past this point
		// finishes via editReply/followUp instead of reply/updateMessage.
		await client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const [question] = await getContext().db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${questionId}
		`;

		if (!question) {
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
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
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'This AMA session has ended.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Determine the next queue up front so the claim below can move the row straight to its target
		// state; this also doubles as a lock — only one concurrent click can win the row.
		const nextQueue = getNextQueue(CurrentlyInQueue.mod, session);
		const targetState = nextQueue?.kind === CurrentlyInQueue.guest ? 'PENDING_GUEST_REVIEW' : 'APPROVED';

		const [claimed] = await getContext().db<AmaQuestions[]>`
			UPDATE ama_questions
			SET state = ${targetState}, updated_at = now()
			WHERE id = ${question.id} AND state = 'PENDING_MOD_REVIEW'
			RETURNING *
		`;

		if (!claimed) {
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'This question was already handled by another moderator.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Get user details from the interaction
		const user = await client.api.users.get(question.authorId);
		const member = interaction.guild_id
			? await client.api.guilds.getMember(interaction.guild_id, question.authorId).catch(() => undefined)
			: undefined;

		// Attachments aren't persisted on the row, so we carry them forward off the source message; the
		// question text itself comes straight from the DB (the source message's text has a footer baked in).
		const attachments = interaction.message.attachments ?? [];

		try {
			if (nextQueue?.kind === CurrentlyInQueue.guest) {
				// Post to guest queue
				const msg = await postToGuestQueue({
					attachments,
					content: question.content,
					member,
					question,
					session,
					user,
				});

				await getContext().db`
					UPDATE ama_questions SET guest_queue_message_id = ${msg.id} WHERE id = ${question.id}
				`;
			} else {
				// Post directly to answers channel
				const msg = await postToAnswersChannel({
					attachments,
					content: question.content,
					member,
					question,
					session,
					user,
				});

				await getContext().db`
					UPDATE ama_questions SET answers_message_id = ${msg.id} WHERE id = ${question.id}
				`;
			}

			// Update the message to show it was approved
			await client.api.interactions.editReply(interaction.application_id, interaction.token, {
				components: [
					{
						type: ComponentType.ActionRow,
						components: [
							{
								type: ComponentType.Button,
								style: ButtonStyle.Success,
								label: '✅ Approved',
								custom_id: 'approved-disabled',
								disabled: true,
							},
						],
					},
				],
			});
		} catch (error) {
			// The row is already claimed (state flipped) at this point; if the queue post itself failed, the
			// question is stuck claimed with no downstream message and needs manual follow-up — logged loudly
			// here rather than attempting a rollback/saga for what should be a rare failure mode.
			getContext().logger.error({ error, questionId }, 'Failed to approve question');
			await client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: 'Failed to approve question. Please try again.',
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
