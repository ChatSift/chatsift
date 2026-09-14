import { getContext } from '@chatsift/backend-core';
import type { CategoriesId } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ModmailCategoryCount {
	count: number;
	/**
	 * `null` is the uncategorised bucket -- tickets opened through a panel with no categories, or whose
	 * category was deleted out from under them (`threads.category_id` is `ON DELETE SET NULL`). Omitted
	 * entirely when it is empty, unlike the real categories, which are listed even at 0.
	 */
	id: CategoriesId | null;
	name: string;
}

export interface ModmailStats {
	/**
	 * Tickets per category, ordered the way the Categories page orders them (`sort_order`, then name), with
	 * the uncategorised bucket last. Same shape and the same reasoning as `getAMAStats.ts`'s `byTag`: an
	 * unbounded list, so the dashboard renders it as chips rather than tiles.
	 */
	byCategory: ModmailCategoryCount[];
	messages: {
		/**
		 * Mod-to-mod notes posted in the ticket's thread, which never reach the user.
		 */
		internalNotes: number;
		staff: number;
		total: number;
		user: number;
	};
	threads: {
		/**
		 * Mean ticket lifetime in seconds, over closed tickets only -- `null` when the guild has never closed
		 * one. Mean rather than median: a median needs a percentile aggregate over the whole guild's tickets,
		 * and this number is read as a rough "how long do we sit on these", not an SLA.
		 */
		avgTimeToCloseSeconds: number | null;
		blockedUsers: number;
		closed: number;
		last30Days: number;
		last7Days: number;
		open: number;
		total: number;
		uniqueUsers: number;
	};
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/stats',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ModmailStats> {
		const { guildId } = req.params;
		const db = getContext().db;

		const [[threadTotals], [messageTotals], [blocked], categoryCounts, [uncategorised]] = await Promise.all([
			db<
				{
					avgTimeToCloseSeconds: string | null;
					closed: string;
					last30Days: string;
					last7Days: string;
					open: string;
					total: string;
					uniqueUsers: string;
				}[]
			>`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE closed_at IS NULL) AS open,
					COUNT(*) FILTER (WHERE closed_at IS NOT NULL) AS closed,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '30 days') AS last_30_days,
					COUNT(*) FILTER (WHERE created_at >= now() - INTERVAL '7 days') AS last_7_days,
					COUNT(DISTINCT user_id) AS unique_users,
					-- AVG already skips the NULL interval an open ticket produces, so this needs no FILTER.
					EXTRACT(EPOCH FROM AVG(closed_at - created_at)) AS avg_time_to_close_seconds
				FROM threads
				WHERE guild_id = ${guildId}
			`,
			// `is_system` rows (the opening greeting, the closing farewell) are excluded from both sides rather
			// than attributed to whichever id they happen to carry -- nobody wrote them, and counting them as
			// staff replies would make every ticket look like it got answered.
			// `user`/`staff` would be the natural aliases, but `USER` is a reserved word in SQL -- unquoted it
			// parses as the current-role function, not a label.
			db<{ internalNotes: string; staffMessages: string; total: string; userMessages: string }[]>`
				SELECT
					COUNT(*) AS total,
					COUNT(*) FILTER (WHERE NOT is_internal AND NOT is_system AND staff_id IS NULL) AS user_messages,
					COUNT(*) FILTER (WHERE NOT is_internal AND NOT is_system AND staff_id IS NOT NULL) AS staff_messages,
					COUNT(*) FILTER (WHERE is_internal) AS internal_notes
				FROM thread_messages
				WHERE guild_id = ${guildId}
			`,
			db<{ count: string }[]>`
				SELECT COUNT(*) AS count FROM blocks
				WHERE guild_id = ${guildId} AND (expires_at IS NULL OR expires_at > now())
			`,
			// LEFT JOIN, so a category nobody has used yet reports 0 instead of dropping out of the list --
			// same call `getAMAStats.ts` makes for unused tags.
			db<{ count: string; id: CategoriesId; name: string }[]>`
				SELECT c.id, c.name, COUNT(t.id) AS count
				FROM categories c
				LEFT JOIN threads t ON t.category_id = c.id
				WHERE c.guild_id = ${guildId}
				GROUP BY c.id, c.name, c.sort_order
				ORDER BY c.sort_order ASC, c.name ASC
			`,
			db<{ count: string }[]>`
				SELECT COUNT(*) AS count FROM threads
				WHERE guild_id = ${guildId} AND category_id IS NULL
			`,
		]);

		const byCategory: ModmailCategoryCount[] = categoryCounts.map(({ id, name, count }) => ({
			id,
			name,
			count: Number(count),
		}));

		const uncategorisedCount = Number(uncategorised?.count ?? 0);
		if (uncategorisedCount > 0) {
			byCategory.push({ id: null, name: 'Uncategorised', count: uncategorisedCount });
		}

		const avgTimeToCloseSeconds = threadTotals?.avgTimeToCloseSeconds;

		return {
			byCategory,
			messages: {
				internalNotes: Number(messageTotals?.internalNotes ?? 0),
				staff: Number(messageTotals?.staffMessages ?? 0),
				total: Number(messageTotals?.total ?? 0),
				user: Number(messageTotals?.userMessages ?? 0),
			},
			threads: {
				avgTimeToCloseSeconds:
					avgTimeToCloseSeconds === null || avgTimeToCloseSeconds === undefined ? null : Number(avgTimeToCloseSeconds),
				blockedUsers: Number(blocked?.count ?? 0),
				closed: Number(threadTotals?.closed ?? 0),
				last30Days: Number(threadTotals?.last30Days ?? 0),
				last7Days: Number(threadTotals?.last7Days ?? 0),
				open: Number(threadTotals?.open ?? 0),
				total: Number(threadTotals?.total ?? 0),
				uniqueUsers: Number(threadTotals?.uniqueUsers ?? 0),
			},
		};
	},
});
