import type { Logger } from '@chatsift/backend-core';
import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import { fetchUser } from '@chatsift/bot-core';
import {
	amaQuestionsChannel,
	getAnswerEmbed,
	getBaseEmbeds,
	MERGE_SOURCE_STATES,
	MERGE_TARGET_STATES,
	resolveEmbedsForEdit,
} from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type {
	APIAttachment,
	APIEmbed,
	APIMessageComponentInteraction,
	APIMessageStringSelectInteractionData,
} from '@discordjs/core';
import { CDNRoutes, ImageFormat, MessageFlags, RouteBases } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { countExtraAskers } from '../lib/askers.js';

interface CurrentMessage {
	channelId: string;
	/**
	 * Mirrors postToQueue's own `includeUserId: true` -- the only queue that ever shows it.
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
	// APPROVED has no queue message "of its own" -- when prepared answers hold a question here, the
	// queue message it got posted to is left in place with its button swapped rather than deleted, and
	// the question's own `queue_message_id` keeps pointing at it. Mirrors `services/api`'s own `util.ts`.
	if (
		(question.state === 'PENDING_REVIEW' || question.state === 'APPROVED') &&
		session.queueId &&
		question.queueMessageId
	) {
		return { channelId: session.queueId, messageId: question.queueMessageId, includeUserId: true };
	}

	if (question.state === 'ASKED' && question.answersMessageId) {
		return { channelId: session.answersChannelId, messageId: question.answersMessageId, includeUserId: false };
	}

	return null;
}

type MergeResult =
	| {
			duplicate: AmaQuestions;
			/**
			 * Counted inside the merge transaction itself, so refreshing the embed below costs no extra
			 * round trip (and can't read a count some concurrent merge has moved on from).
			 */
			extraAskerCount: number;
			kind: 'ok';
			original: AmaQuestions;
			session: AmaSessions;
	  }
	| { kind: 'mismatch' }
	| { kind: 'not-mergeable'; side: 'duplicate' | 'original'; state: string };

/**
 * Completes the duplicate-merge flow started by `markDuplicate.ts` (#293 follow-up): the duplicate
 * question is deleted, its author and preserved content (and anyone already merged into it, for
 * chained merges) is recorded as an extra asker on the original, and the original's live Discord
 * message (if any) is refreshed -- showing a count of the extra people who asked it (#326; who they
 * are stays a dashboard-only detail).
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
				// search results -- either question's state can change (approved, denied, asked/sent) in the
				// time between that search and this select being submitted. The two sides have different bars
				// (#328): merging away deletes the question, absorbing an asker doesn't.
				if (!MERGE_SOURCE_STATES.has(duplicate.state)) {
					return { kind: 'not-mergeable', side: 'duplicate', state: duplicate.state };
				}

				if (!MERGE_TARGET_STATES.has(original.state)) {
					return { kind: 'not-mergeable', side: 'original', state: original.state };
				}

				const [session] = await sql<AmaSessions[]>`
					SELECT * FROM ama_sessions WHERE id = ${original.amaId}
				`;

				if (!session) {
					throw new Error(`No AMA session found for id ${original.amaId}`);
				}

				await sql`
					INSERT INTO ama_question_askers (question_id, author_id, content)
					VALUES (${originalId}, ${duplicate.authorId}, ${duplicate.content})
					ON CONFLICT (question_id, author_id) DO NOTHING
				`;

				// Chained merge: anyone previously merged into the duplicate (with their preserved content)
				// carries over to the original.
				await sql`
					INSERT INTO ama_question_askers (question_id, author_id, content)
					SELECT ${originalId}, author_id, content FROM ama_question_askers WHERE question_id = ${duplicateId}
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

				return { duplicate, extraAskerCount: await countExtraAskers(sql, original), kind: 'ok', original, session };
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
					content:
						merged.side === 'duplicate'
							? `This question is now in state ${merged.state} and can no longer be merged away. This merge was aborted.`
							: `The question you picked is now in state ${merged.state} and can no longer absorb a duplicate. This merge was aborted.`,
					components: [],
				});
				return;
			}

			const { duplicate, extraAskerCount, original, session } = merged;

			await publishRealtimeInvalidate(amaQuestionsChannel(session.guildId, original.amaId));

			// Best-effort cleanup of whichever of the duplicate's queue messages exist -- a lost race or a
			// message deleted out-of-band means this simply no-ops for that one.
			const duplicateMessages: { channelId: string | null; messageId: string | null }[] = [
				{ channelId: session.queueId, messageId: duplicate.queueMessageId },
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

			// Refresh the original's live message (if any) so its merged-asker count reflects the merge that
			// just happened (#326) -- who those askers are stays a dashboard-only detail. Best-effort: the
			// merge itself already committed above, so a failure here (deleted message, rate limit, a
			// transient Discord error) shouldn't be reported as a failed merge.
			const currentMessage = resolveCurrentMessage(original, session);
			if (currentMessage) {
				try {
					const [attachments, user] = await Promise.all([
						fetchAttachments(currentMessage.channelId, currentMessage.messageId),
						fetchUser(getContext().service.client.api, original.authorId).catch(() => null),
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
						extraAskerCount,
						guildId: session.guildId,
						includeUserId: currentMessage.includeUserId,
						member,
						reserveEmbedSlots: hasAnswer ? 1 : 0,
						user: user ?? undefined,
					});

					if (hasAnswer) {
						const answeredByUser = original.answeredById
							? await fetchUser(getContext().service.client.api, original.answeredById).catch(() => null)
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

					// `resolveEmbedsForEdit` because these image urls were read straight back off the live message
					// -- resending them resolved on a PATCH makes Discord render the image twice (see its doc
					// comment).
					await getContext().service.client.api.channels.editMessage(
						currentMessage.channelId,
						currentMessage.messageId,
						{
							embeds: resolveEmbedsForEdit(embeds),
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
