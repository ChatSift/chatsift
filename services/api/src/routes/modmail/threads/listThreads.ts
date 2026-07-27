import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { createPaginationQuerySchema, snowflakeSchema } from '../../../util/schemas.js';
import type { ThreadCategory } from './util.js';
import { resolveUser, toThreadCategory } from './util.js';

const querySchema = z
	.strictObject({
		include_closed: z.stringbool().optional().default(false),
	})
	.extend(createPaginationQuerySchema(25, 100).shape);
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListThreadsQuery = z.input<typeof querySchema>;

export interface ThreadListItem extends Threads {
	category: ThreadCategory | null;
	user: APIUser | Snowflake;
}

export interface ListThreadsResult {
	nextCursor: number | null;
	threads: ThreadListItem[];
}

/**
 * Raw shape of a single joined row before the category/user enrichment below reshapes it -- `t.*` plus
 * the two extra category columns needed for the `{ id, name, emoji }` badge (`t.category_id` already
 * carries the category's id, so only `name`/`emoji` need pulling in from the join).
 */
interface ThreadListRow extends Threads {
	categoryEmoji: string | null;
	categoryName: string | null;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/threads',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ListThreadsResult> {
		const { cursor, include_closed, limit } = req.query;
		const { guildId } = req.params;

		const db = getContext().db;
		// Fetches one extra row over `limit` purely to know whether a next page exists -- cheaper than a
		// separate `COUNT(*)` query, and the extra row is sliced back off below before returning.
		const rows = await db<ThreadListRow[]>`
			SELECT t.*, c.name AS category_name, c.emoji AS category_emoji
			FROM threads t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.guild_id = ${guildId}
			${include_closed ? db`` : db`AND t.closed_at IS NULL`}
			${cursor ? db`AND t.id < ${cursor}` : db``}
			ORDER BY t.id DESC
			LIMIT ${limit + 1}
		`;

		const hasNextPage = rows.length > limit;
		const page = hasNextPage ? rows.slice(0, limit) : rows;

		// Dedup'd rather than one `resolveUser` per row -- the same user can easily have several threads
		// on this page (that's the whole point of "past ticket history"), and re-resolving them
		// individually would multiply Discord API calls for no benefit. Same approach `getThread.ts` uses
		// for its `participants` map.
		const userIds = new Set(page.map((row) => row.userId));
		const userEntries = await Promise.all(
			[...userIds].map(async (userId): Promise<[string, APIUser | Snowflake]> => [userId, await resolveUser(userId)]),
		);
		const usersById = new Map(userEntries);

		const threads = page.map((row): ThreadListItem => {
			const { categoryEmoji, categoryName, ...thread } = row;
			const category = toThreadCategory(
				thread.categoryId ? { emoji: categoryEmoji, id: thread.categoryId, name: categoryName! } : null,
			);
			return { ...thread, category, user: usersById.get(thread.userId)! };
		});

		return { nextCursor: hasNextPage ? page.at(-1)!.id : null, threads };
	},
});
