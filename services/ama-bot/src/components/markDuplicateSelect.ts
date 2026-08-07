import type { Logger } from '@chatsift/backend-core';
import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { amaQuestionsChannel, getAnswerEmbed, getBaseEmbeds } from '@chatsift/core';
import type { AmaQuestionAskers, AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIAttachment,
	APIEmbed,
	APIMessageComponentInteraction,
	APIMessageStringSelectInteractionData,
} from '@discordjs/core';
import { CDNRoutes, ImageFormat, MessageFlags, RouteBases } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { MERGEABLE_STATES } from './markDuplicate.js';

/**
 * How many resolved merged-asker names the refreshed embed actually shows -- `getBaseEmbeds` only ever
 * displays the primary author plus up to 2 more before collapsing the rest into a "[...and N more]"
 * count, so resolving beyond that (a Discord API call per asker) would be pure waste on a merge with
 * many duplicates.
 */
const MAX_SHOWN_EXTRA_ASKERS = 2;

interface CurrentMessage {
	channelId: string;
	/**
	 * Mirrors postToModQueue/postToFlaggedQueue's own `includeUserId: true` -- the only two queues that ever show it.
	 */
	includeUserId: boolean;
	messageId: string;
}

/**
 * Resolves which (channelId, messageId) pair currently displays a question, if any -- a question can
 * be mid-flight with no live message at all (dash-only stage), in which case there's nothing to
 * refresh.
 */
function resolveCurrentMessage(question: AmaQuestions, session: AmaSessions): CurrentMessage | null {
	if (question.state === 'PENDING_MOD_REVIEW' && session.modQueueId && question.modQueueMessageId) {
		return { channelId: session.modQueueId, messageId: question.modQueueMessageId, includeUserId: true };
	}

	if (question.state === 'PENDING_GUEST_REVIEW' && session.guestQueueId && question.guestQueueMessageId) {
		return { channelId: session.guestQueueId, messageId: question.guestQueueMessageId, includeUserId: false };
	}

	if (question.state === 'FLAGGED' && session.flaggedQueueId && question.flaggedQueueMessageId) {
		return { channelId: session.flaggedQueueId, messageId: question.flaggedQueueMessageId, includeUserId: true };
	}

	// APPROVED has no queue message "of its own" -- when prepared answers hold a question here, the last
	// queue message it actually got posted to (guest queue takes priority, since that's the later stage)
	// is left in place with its button swapped rather than deleted, and the question's own
	// {mod,guest}_queue_message_id keeps pointing at it. Mirrors `services/api`'s own `util.ts`.
	if (question.state === 'APPROVED') {
		if (session.guestQueueId && question.guestQueueMessageId) {
			return { channelId: session.guestQueueId, messageId: question.guestQueueMessageId, includeUserId: false };
		}

		if (session.modQueueId && question.modQueueMessageId) {
			return { channelId: session.modQueueId, messageId: question.modQueueMessageId, includeUserId: true };
		}
	}

	if (question.state === 'ASKED' && question.answersMessageId) {
		return { channelId: session.answersChannelId, messageId: question.answersMessageId, includeUserId: false };
	}

	return null;
}

type MergeResult =
	| {
			duplicate: AmaQuestions;
			kind: 'ok';
			mergedAskerRows: AmaQuestionAskers[];
			original: AmaQuestions;
			session: AmaSessions;
	  }
	| { kind: 'mismatch' }
	| { kind: 'not-mergeable'; state: string };

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

			// Locking both rows up front (in ascending-id order, a single statement so Postgres acquires the
			// locks in a consistent order) prevents a deadlock against another merge touching one of the same
			// two rows concurrently (e.g. this select and a dashboard bulk-merge racing on the same original).
			const merged = await getContext().db.begin<MergeResult>(async (sql) => {
				const lockIds = [duplicateId, originalId].sort((a, b) => a - b);
				const rows = await sql<AmaQuestions[]>`
					SELECT * FROM ama_questions WHERE id = ANY(${lockIds}) ORDER BY id FOR UPDATE
				`;
				const duplicate = rows.find((row) => row.id === duplicateId);
				const original = rows.find((row) => row.id === originalId);

				if (!duplicate || !original) {
					return { kind: 'mismatch' };
				}

				if (duplicate.amaId !== original.amaId) {
					return { kind: 'mismatch' };
				}

				// Re-checked here, under the row lock, rather than trusting `markDuplicate.ts`'s own filtered
				// search results -- either question's state can change (denied, flagged, asked, sent) in the
				// time between that search and this select being submitted.
				if (!MERGEABLE_STATES.has(duplicate.state)) {
					return { kind: 'not-mergeable', state: duplicate.state };
				}

				if (!MERGEABLE_STATES.has(original.state)) {
					return { kind: 'not-mergeable', state: original.state };
				}

				const [session] = await sql<AmaSessions[]>`
					SELECT * FROM ama_sessions WHERE id = ${original.amaId}
				`;

				if (!session) {
					throw new Error(`No AMA session found for id ${original.amaId}`);
				}

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

				const deleted = await sql<Pick<AmaQuestions, 'id'>[]>`
					DELETE FROM ama_questions WHERE id = ${duplicateId} RETURNING id
				`;

				if (deleted.length !== 1) {
					throw new Error(
						`Expected to delete exactly 1 duplicate question (#${duplicateId}), deleted ${deleted.length}`,
					);
				}

				const mergedAskerRows = await sql<AmaQuestionAskers[]>`
					SELECT * FROM ama_question_askers WHERE question_id = ${originalId} ORDER BY merged_at ASC
				`;

				return { duplicate, kind: 'ok', mergedAskerRows, original, session };
			});

			if (merged.kind === 'mismatch') {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: 'Both questions must belong to the same AMA. This merge was aborted.',
					components: [],
				});
				return;
			}

			if (merged.kind === 'not-mergeable') {
				await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
					content: `One of these questions is now in state ${merged.state}, which can no longer be merged. This merge was aborted.`,
					components: [],
				});
				return;
			}

			const { duplicate, mergedAskerRows, original, session } = merged;

			await publishRealtimeInvalidate(amaQuestionsChannel(session.guildId, original.amaId));

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

			// Refresh the original's live message (if any) to reflect the merged askers. Best-effort: the
			// merge itself already committed above, so a failure here (deleted message, rate limit, a
			// transient Discord error) shouldn't be reported as a failed merge.
			const currentMessage = resolveCurrentMessage(original, session);
			if (currentMessage) {
				try {
					const [attachments, extraAskers, user] = await Promise.all([
						fetchAttachments(currentMessage.channelId, currentMessage.messageId),
						Promise.all(
							mergedAskerRows.slice(0, MAX_SHOWN_EXTRA_ASKERS).map(async (row) => {
								const resolvedUser = await getContext()
									.service.client.api.users.get(row.authorId)
									.catch(() => null);
								return resolvedUser?.global_name ?? resolvedUser?.username ?? row.authorId;
							}),
						),
						getContext()
							.service.client.api.users.get(original.authorId)
							.catch(() => undefined),
					]);
					const member = session.guildId
						? await getContext()
								.service.client.api.guilds.getMember(session.guildId, original.authorId)
								.catch(() => undefined)
						: undefined;

					const hasAnswer = original.state === 'ASKED' && Boolean(original.answerContent);
					const embeds: APIEmbed[] = getBaseEmbeds({
						attachments,
						content: original.content,
						extraAskerDisplayNames: extraAskers,
						extraAskerTotalCount: mergedAskerRows.length,
						guildId: session.guildId,
						includeUserId: currentMessage.includeUserId,
						member,
						reserveEmbedSlots: hasAnswer ? 1 : 0,
						user,
					});

					if (hasAnswer) {
						const answeredByUser = original.answeredById
							? await getContext()
									.service.client.api.users.get(original.answeredById)
									.catch(() => null)
							: null;
						const answeredByDisplayName =
							answeredByUser?.global_name ?? answeredByUser?.username ?? original.answeredById ?? 'Unknown User';
						const answeredByAvatarURL = answeredByUser?.avatar
							? `${RouteBases.cdn}${CDNRoutes.userAvatar(answeredByUser.id, answeredByUser.avatar, ImageFormat.PNG)}`
							: undefined;

						embeds.push(
							getAnswerEmbed({
								answerContent: original.answerContent!,
								answerImageUrl: original.answerImageUrl,
								answeredByAvatarURL,
								answeredByDisplayName,
							}),
						);
					}

					await getContext().service.client.api.channels.editMessage(
						currentMessage.channelId,
						currentMessage.messageId,
						{
							embeds,
						},
					);
				} catch (error) {
					logger.warn({ err: error, ...currentMessage }, 'Failed to refresh merged question message');
				}
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

/**
 * A question's attachments aren't persisted on its own row -- fetches the live message and reads them
 * back off it instead. Mirrors `services/api`'s `resolveQuestionAttachments`.
 */
async function fetchAttachments(channelId: string, messageId: string): Promise<APIAttachment[]> {
	try {
		const message = await getContext().service.client.api.channels.getMessage(channelId, messageId);
		return message.attachments;
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return [];
		}

		throw error;
	}
}
