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
	/**
	 * How many prior versions exist in `thread_message_content_edits` (Phase 3, #261) -- a count rather
	 * than the full history so a page of messages doesn't balloon in size for messages nobody ever clicks
	 * the "edited" badge on. The full list is a separate on-demand fetch, see `getMessageEdits.ts`.
	 */
	editCount: number;
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
	/**
	 * The `local_thread_message_id` to continue paging *forward* (newer messages) from, or `null` if this
	 * page already reaches the latest message in the thread. Symmetric with `previousCursor` below --
	 * unlike Phase 2 (which only ever paged forward from the oldest message), Phase 3's initial load lands
	 * on the latest messages, so scrolling up needs its own cursor from the very first fetch.
	 */
	nextCursor: number | null;
	otherThreads: Threads[];
	/**
	 * Dedup'd `{ userId/staffId -> resolved user }` map, scoped to the current message page only.
	 */
	participants: Record<string, APIUser | Snowflake>;
	/**
	 * The `local_thread_message_id` to continue paging *backward* (older messages) from, or `null` if this
	 * page already reaches the very first message in the thread.
	 */
	previousCursor: number | null;
	userThreadCount: number;
}

/**
 * Raw shape of a joined `thread_messages`/`thread_message_content` row before the enrichment below
 * reshapes it -- the `recorded*` columns are all `null` together for a message that predates recording.
 */
interface ThreadMessageRow extends ThreadMessages {
	recordedAttachments: unknown;
	recordedContent: string | null;
	recordedEditCount: string;
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

		// Unlike Phase 2, `direction` decides query order even with no cursor -- there's no more implicit
		// "no cursor always means oldest-first" special case. `direction: 'before'` + no cursor (the default,
		// see `querySchema`) fetches the *latest* page (descending from the true end, reversed back to
		// ascending below); `direction: 'after'` + no cursor fetches the very first page from the start.
		// Either way, a cursor continues paging in whichever direction it's paired with. This is what lets
		// the frontend land on the latest messages by default while still being able to jump to the oldest
		// ones, and to page in both directions from any point (see `previousCursor`/`nextCursor` below).
		const goingForward = direction === 'after';
		const rows = await db<ThreadMessageRow[]>`
			SELECT
				tm.*,
				tmc.content AS recorded_content,
				tmc.replied_to_thread_message_id AS recorded_replied_to_thread_message_id,
				tmc.is_forwarded AS recorded_is_forwarded,
				tmc.attachments AS recorded_attachments,
				tmc.stickers AS recorded_stickers,
				tmc.recorded_at AS recorded_recorded_at,
				(SELECT COUNT(*) FROM thread_message_content_edits e WHERE e.thread_message_id = tm.id) AS recorded_edit_count
			FROM thread_messages tm
			LEFT JOIN thread_message_content tmc ON tmc.thread_message_id = tm.id
			WHERE tm.thread_id = ${threadId}
			${
				cursor === undefined
					? db``
					: goingForward
						? db`AND tm.local_thread_message_id > ${cursor}`
						: db`AND tm.local_thread_message_id < ${cursor}`
			}
			ORDER BY tm.local_thread_message_id ${goingForward ? db`ASC` : db`DESC`}
			LIMIT ${limit}
		`;

		const orderedPage = goingForward ? rows : [...rows].reverse();

		// Symmetric boundary check in both directions, regardless of which direction was actually queried --
		// simpler and just as cheap as tracking a single "hasMore in the direction we asked for" flag, and it
		// means every page (including the very first one) always carries both cursors a bi-directional
		// infinite query needs.
		const firstId = orderedPage[0]?.localThreadMessageId;
		const lastId = orderedPage.at(-1)?.localThreadMessageId;
		const [olderExists, newerExists] = await Promise.all([
			firstId === undefined
				? undefined
				: db`SELECT 1 FROM thread_messages WHERE thread_id = ${threadId} AND local_thread_message_id < ${firstId} LIMIT 1`,
			lastId === undefined
				? undefined
				: db`SELECT 1 FROM thread_messages WHERE thread_id = ${threadId} AND local_thread_message_id > ${lastId} LIMIT 1`,
		]);
		const previousCursor = olderExists?.length ? firstId! : null;
		const nextCursor = newerExists?.length ? lastId! : null;

		const messages = await Promise.all(
			orderedPage.map(async (row): Promise<ThreadDetailMessage> => {
				const {
					recordedAttachments,
					recordedContent,
					recordedEditCount,
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
						editCount: Number(recordedEditCount),
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
			previousCursor,
			userThreadCount,
		};
	},
});
