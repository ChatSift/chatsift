import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestionAskers, AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';

/**
 * Resolves which (channelId, messageId) pair currently displays a question, if any -- a question can
 * be mid-flight with no live message at all (e.g. held at APPROVED awaiting a dashboard Send), in
 * which case there's nothing to refresh.
 */
function resolveCurrentMessage(
	question: AmaQuestions,
	session: AmaSessions,
): { channelId: string; messageId: string } | null {
	if (question.state === 'PENDING_MOD_REVIEW' && session.modQueueId && question.modQueueMessageId) {
		return { channelId: session.modQueueId, messageId: question.modQueueMessageId };
	}

	if (question.state === 'PENDING_GUEST_REVIEW' && session.guestQueueId && question.guestQueueMessageId) {
		return { channelId: session.guestQueueId, messageId: question.guestQueueMessageId };
	}

	if (question.state === 'FLAGGED' && session.flaggedQueueId && question.flaggedQueueMessageId) {
		return { channelId: session.flaggedQueueId, messageId: question.flaggedQueueMessageId };
	}

	if (question.state === 'ASKED' && question.answersMessageId) {
		return { channelId: session.answersChannelId, messageId: question.answersMessageId };
	}

	return null;
}

/**
 * Completes the duplicate-merge flow started by `markDuplicate.ts` (#293 follow-up): the duplicate
 * question is deleted, its author (and anyone already merged into it, for chained merges) is
 * recorded as an extra asker on the original, and the original's live message (if any) is refreshed
 * to show "Asked by X, Y, Z [...and N more]".
 */
export default class MarkDuplicateSelectComponent implements ComponentHandler<string> {
	public readonly name = 'mark-duplicate-select';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, duplicateIdStr: string, logger: Logger) {
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const duplicateId = Number.parseInt(duplicateIdStr, 10);
		const [originalIdRaw] = (interaction.data as APIMessageStringSelectInteractionData).values;
		const originalId = Number.parseInt(originalIdRaw!, 10);

		try {
			if (originalId === duplicateId) {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: 'A question cannot be a duplicate of itself.',
					components: [],
				});
				return;
			}

			const [duplicate] = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions WHERE id = ${duplicateId}
			`;
			const [original] = await getContext().db<AmaQuestions[]>`
				SELECT * FROM ama_questions WHERE id = ${originalId}
			`;

			if (!duplicate || !original || duplicate?.amaId !== original?.amaId) {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: 'Both questions must belong to the same AMA. This merge was aborted.',
					components: [],
				});
				return;
			}

			const [session] = await getContext().db<AmaSessions[]>`
				SELECT * FROM ama_sessions WHERE id = ${original.amaId}
			`;

			if (!session) {
				throw new Error(`No AMA session found for id ${original.amaId}`);
			}

			const mergedAskerRows = await getContext().db.begin(async (sql) => {
				await sql`
					INSERT INTO ama_question_askers (question_id, author_id)
					VALUES (${originalId}, ${duplicate.authorId})
					ON CONFLICT (question_id, author_id) DO NOTHING
				`;

				// Chained merge: anyone previously merged into the duplicate carries over to the original.
				await sql`
					INSERT INTO ama_question_askers (question_id, author_id)
					SELECT ${originalId}, author_id FROM ama_question_askers WHERE question_id = ${duplicateId}
					ON CONFLICT (question_id, author_id) DO NOTHING
				`;

				await sql`DELETE FROM ama_questions WHERE id = ${duplicateId}`;

				return sql<AmaQuestionAskers[]>`
					SELECT * FROM ama_question_askers WHERE question_id = ${originalId} ORDER BY merged_at ASC
				`;
			});

			// Best-effort cleanup of whichever of the duplicate's queue messages exist -- a lost race or a
			// message deleted out-of-band means this simply no-ops for that one.
			const duplicateMessages: { channelId: string | null; messageId: string | null }[] = [
				{ channelId: session.modQueueId, messageId: duplicate.modQueueMessageId },
				{ channelId: session.guestQueueId, messageId: duplicate.guestQueueMessageId },
				{ channelId: session.flaggedQueueId, messageId: duplicate.flaggedQueueMessageId },
				{ channelId: session.answersChannelId, messageId: duplicate.answersMessageId },
			];
			await Promise.all(
				duplicateMessages
					.filter((entry): entry is { channelId: string; messageId: string } =>
						Boolean(entry.channelId && entry.messageId),
					)
					.map(async ({ channelId, messageId }) =>
						getContext()
							.service.client.api.channels.deleteMessage(channelId, messageId)

							.catch((error: unknown) =>
								logger.debug({ err: error, channelId, messageId }, 'Failed to delete duplicate message'),
							),
					),
			);

			// Refresh the original's live message (if any) to reflect the merged askers.
			const currentMessage = resolveCurrentMessage(original, session);
			if (currentMessage) {
				const extraAskers = await Promise.all(
					mergedAskerRows.map(async (row) => {
						const user = await getContext()
							.service.client.api.users.get(row.authorId)
							.catch(() => null);
						return user?.global_name ?? user?.username ?? row.authorId;
					}),
				);

				const user = await getContext()
					.service.client.api.users.get(original.authorId)
					.catch(() => undefined);
				const member = session.guildId
					? await getContext()
							.service.client.api.guilds.getMember(session.guildId, original.authorId)
							.catch(() => undefined)
					: undefined;

				const embeds = getBaseEmbeds({
					attachments: [],
					content: original.content,
					extraAskerDisplayNames: extraAskers,
					guildId: session.guildId,
					member,
					user,
				});

				await getContext()
					.service.client.api.channels.editMessage(currentMessage.channelId, currentMessage.messageId, { embeds })
					.catch((error: unknown) =>
						logger.warn({ err: error, ...currentMessage }, 'Failed to refresh merged question message'),
					);
			}

			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: `Merged #${duplicateId} into #${originalId}.`,
				components: [],
			});

			logger.info({ duplicateId, originalId, amaId: original.amaId }, 'Merged duplicate question');
		} catch (error) {
			logger.error({ err: error, duplicateId, originalId }, 'Failed to merge duplicate question');
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'Failed to merge questions. Please try again.',
				components: [],
			});
		}
	}
}
