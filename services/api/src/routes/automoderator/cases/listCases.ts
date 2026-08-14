import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { createPaginationQuerySchema, snowflakeSchema } from '../../../util/schemas.js';
import { caseActionSchema } from '../schemas.js';
import type { CaseWithUsers } from './util.js';
import { resolveCaseUsers } from './util.js';

const querySchema = z
	.strictObject({
		/**
		 * Doubles as "history by user": the case-detail sidebar's *other cases for this account* and a
		 * moderator filtering the browser are the same query, so there is no separate history route.
		 */
		target_id: snowflakeSchema.optional(),
		mod_id: snowflakeSchema.optional(),
		action: caseActionSchema.optional(),
		// Off by default, matching `/history`: a pardoned warn is one the guild decided shouldn't count.
		include_pardoned: z.stringbool().optional().default(false),
	})
	.extend(createPaginationQuerySchema(25, 100).shape);

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListCasesQuery = z.input<typeof querySchema>;

export interface ListCasesResult {
	cases: CaseWithUsers[];
	nextCursor: number | null;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/cases',
	schema: { query: querySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListCasesResult> {
		const { action, cursor, include_pardoned, limit, mod_id, target_id } = req.query;
		const { guildId } = req.params;

		const db = getContext().db;

		// Keyset on `id` rather than `case_id`: both are monotonic per guild, but `id` is what the index
		// `automoderator_cases_guild_id_id_idx` is ordered by, and case numbers can have gaps.
		//
		// One extra row over `limit` to detect a next page, sliced back off below -- cheaper than a COUNT(*),
		// same approach as `modmail/threads/listThreads.ts`.
		const rows = await db<AutomoderatorCases[]>`
			SELECT * FROM automoderator_cases
			WHERE guild_id = ${guildId}
			${cursor ? db`AND id < ${cursor}` : db``}
			${target_id ? db`AND target_id = ${target_id}` : db``}
			${mod_id ? db`AND mod_id = ${mod_id}` : db``}
			${action ? db`AND action_type = ${action as AutomoderatorCaseAction}` : db``}
			${include_pardoned ? db`` : db`AND pardoned_by IS NULL`}
			ORDER BY id DESC
			LIMIT ${limit + 1}
		`;

		const hasNextPage = rows.length > limit;
		const page = hasNextPage ? rows.slice(0, limit) : rows;

		return {
			cases: await resolveCaseUsers(page),
			nextCursor: hasNextPage ? page.at(-1)!.id : null,
		};
	},
});
