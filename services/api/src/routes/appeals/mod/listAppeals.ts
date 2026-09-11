import { getContext } from '@chatsift/backend-core';
import type { AppealStatus, Appeals } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { createPaginationQuerySchema, snowflakeSchema } from '../../../util/schemas.js';
import { appealStatusSchema } from '../schemas.js';
import type { AppealWithUsers } from './util.js';
import { resolveAppealUsers } from './util.js';

const querySchema = z
	.strictObject({
		status: appealStatusSchema.optional(),
		user_id: snowflakeSchema.optional(),
	})
	.extend(createPaginationQuerySchema(25, 100).shape);

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListAppealsQuery = z.input<typeof querySchema>;

export interface ListAppealsResult {
	appeals: AppealWithUsers[];
	nextCursor: number | null;
	/**
	 * How many of this guild's appeals are still waiting on somebody, regardless of the filter in force.
	 *
	 * Answered here rather than counted off the page: the queue's whole job is to say how much work is
	 * outstanding, and a page filtered to `APPROVED` would otherwise report zero. Cheap for the same reason the
	 * filter is -- both ride `appeals_guild_id_status_id_idx`.
	 */
	pendingCount: number;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/appeals/queue',
	schema: { query: querySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListAppealsResult> {
		const { cursor, limit, status, user_id } = req.query;
		const { guildId } = req.params;

		const db = getContext().db;

		const [rows, [pending]] = await Promise.all([
			db<Appeals[]>`
				SELECT * FROM appeals
				WHERE guild_id = ${guildId}
				${cursor ? db`AND id < ${cursor}` : db``}
				${status ? db`AND status = ${status as unknown as AppealStatus}` : db``}
				${user_id ? db`AND user_id = ${user_id}` : db``}
				ORDER BY id DESC
				LIMIT ${limit + 1}
			`,
			db<{ count: string }[]>`
				SELECT count(*) FROM appeals WHERE guild_id = ${guildId} AND status = 'PENDING'
			`,
		]);

		const hasNextPage = rows.length > limit;
		const page = hasNextPage ? rows.slice(0, limit) : rows;

		return {
			appeals: await resolveAppealUsers(page),
			nextCursor: hasNextPage ? page.at(-1)!.id : null,
			pendingCount: Number(pending?.count ?? 0),
		};
	},
});
