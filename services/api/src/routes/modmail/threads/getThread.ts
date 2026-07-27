import { getContext } from '@chatsift/backend-core';
import type { Categories, ThreadMessages, Threads, ThreadMessagesId, ThreadsId } from '@chatsift/db';
import type { APIGuildMember, APIUser, Snowflake } from '@discordjs/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { createPaginationQuerySchema, snowflakeSchema } from '../../../util/schemas.js';
import type { RecordedAttachmentJson, ResolvedThreadMessageAttachment, ThreadCategory } from './util.js';
import {
	countPastThreadsForUser,
	fetchOtherThreadsForUser,
	resolveAppliedTagIds,
	resolveMember,
	resolveMessageAttachments,
	resolveUser,
	toThreadCategory,
} from './util.js';

const querySchema = z
	.strictObject({
		direction: z.enum(['before', 'after']).optional().default('before'),
	})
	.extend(createPaginationQuerySchema(50, 200).shape);
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	threadId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as ThreadsId),
});

export type GetThreadQuery = z.input<typeof querySchema>;

/**
 * Matches `thread_message_content.stickers`'s stored JSONB shape (see schema.sql).
 */
export interface RecordedStickerJson {
	formatType: number;
	id: string;
	name: string;
}

export interface ThreadMessageRecordedContent {
	attachments: ResolvedThreadMessageAttachment[];
	content: string;
	isForwarded: boolean;
	recordedAt: Date;
	repliedToThreadMessageId: ThreadMessagesId | null;
	stickers: RecordedStickerJson[];
}

export interface ThreadDetailMessage extends ThreadMessages {
	/**
	 * `null` means this message predates content recording being enabled for the guild (or it was never
	 * enabled).
	 */
	recordedContent: ThreadMessageRecordedContent | null;
}

export interface ThreadDetail extends Threads {
	appliedTagIds: Snowflake[];
	category: ThreadCategory | null;
	member: APIGuildMember | null;
	messages: ThreadDetailMessage[];
	nextCursor: number | null;
	otherThreads: Threads[];
	/**
	 * Dedup'd `{ userId/staffId -> resolved user }` map, scoped to the current message page only.
	 */
	participants: Record<string, APIUser | Snowflake>;
	userThreadCount: number;
}

/**
 * Raw shape of a joined `thread_messages`/`thread_message_content` row before the enrichment below
 * reshapes it -- the `recorded*` columns are all `null` together for a message that predates recording.
 */
interface ThreadMessageRow extends ThreadMessages {
	recordedAttachments: unknown;
	recordedContent: string | null;
	recordedIsForwarded: boolean | null;
	recordedRecordedAt: Date | null;
	recordedRepliedToThreadMessageId: ThreadMessagesId | null;
	recordedStickers: unknown;
}

async function fetchCategoryForThread(categoryId: Categories['id'] | null): Promise<ThreadCategory | null> {
	if (!categoryId) {
		return null;
	}

	const [row] = await getContext().db<Categories[]>`SELECT * FROM categories WHERE id = ${categoryId}`;
	return toThreadCategory(row ?? null);
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/threads/:threadId',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ThreadDetail> {
		const { guildId, threadId } = req.params;
		const { cursor, direction, limit } = req.query;
		const db = getContext().db;

		const [thread] = await db<Threads[]>`
			SELECT * FROM threads WHERE id = ${threadId} AND guild_id = ${guildId}
		`;

		if (!thread) {
			throw notFound('thread not found');
		}

		// No cursor: first page, always starts from the oldest message regardless of `direction`. With a
		// cursor, `after` continues forward (ascending) from it and `before` pages backward (descending,
		// reversed back to ascending below) -- see `createPaginationQuerySchema`'s doc comment on why
		// cursor pagination at all, and #261's own doc for why `before` matters once Phase 3 adds
		// jump-to-latest + scroll-up.
		const goingForward = cursor === undefined || direction === 'after';
		const rows = await db<ThreadMessageRow[]>`
			SELECT
				tm.*,
				tmc.content AS recorded_content,
				tmc.replied_to_thread_message_id AS recorded_replied_to_thread_message_id,
				tmc.is_forwarded AS recorded_is_forwarded,
				tmc.attachments AS recorded_attachments,
				tmc.stickers AS recorded_stickers,
				tmc.recorded_at AS recorded_recorded_at
			FROM thread_messages tm
			LEFT JOIN thread_message_content tmc ON tmc.thread_message_id = tm.id
			WHERE tm.thread_id = ${threadId}
			${
				cursor === undefined
					? db``
					: direction === 'after'
						? db`AND tm.local_thread_message_id > ${cursor}`
						: db`AND tm.local_thread_message_id < ${cursor}`
			}
			ORDER BY tm.local_thread_message_id ${goingForward ? db`ASC` : db`DESC`}
			LIMIT ${limit + 1}
		`;

		const hasNextPage = rows.length > limit;
		const page = hasNextPage ? rows.slice(0, limit) : rows;
		const orderedPage = goingForward ? page : [...page].reverse();
		const nextCursor = hasNextPage
			? goingForward
				? orderedPage.at(-1)!.localThreadMessageId
				: orderedPage[0]!.localThreadMessageId
			: null;

		const messages = await Promise.all(
			orderedPage.map(async (row): Promise<ThreadDetailMessage> => {
				const {
					recordedAttachments,
					recordedContent,
					recordedIsForwarded,
					recordedRecordedAt,
					recordedRepliedToThreadMessageId,
					recordedStickers,
					...message
				} = row;

				if (recordedContent === null) {
					return { ...message, recordedContent: null };
				}

				const attachments = await resolveMessageAttachments(
					thread.modThreadId,
					message.guildMessageId,
					recordedAttachments as RecordedAttachmentJson[],
				);

				return {
					...message,
					recordedContent: {
						attachments,
						content: recordedContent,
						isForwarded: recordedIsForwarded!,
						recordedAt: recordedRecordedAt!,
						repliedToThreadMessageId: recordedRepliedToThreadMessageId,
						stickers: recordedStickers as RecordedStickerJson[],
					},
				};
			}),
		);

		const participantIds = new Set<string>();
		for (const row of orderedPage) {
			participantIds.add(row.userId);
			if (row.staffId) {
				participantIds.add(row.staffId);
			}
		}

		const [category, member, appliedTagIds, userThreadCount, otherThreads, participantEntries] = await Promise.all([
			fetchCategoryForThread(thread.categoryId),
			resolveMember(guildId, thread.userId),
			resolveAppliedTagIds(thread.modThreadId),
			countPastThreadsForUser(guildId, thread.userId),
			fetchOtherThreadsForUser(guildId, thread.userId, thread.id),
			Promise.all(
				[...participantIds].map(async (id): Promise<[string, APIUser | Snowflake]> => [id, await resolveUser(id)]),
			),
		]);

		return {
			...thread,
			appliedTagIds,
			category,
			member,
			messages,
			nextCursor,
			otherThreads,
			participants: Object.fromEntries(participantEntries),
			userThreadCount,
		};
	},
});
