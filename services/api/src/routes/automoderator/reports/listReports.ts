import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReports, AutomoderatorReportState } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { createPaginationQuerySchema, snowflakeSchema } from '../../../util/schemas.js';
import { reportStateSchema } from '../schemas.js';
import type { ReportWithUsers } from './util.js';
import { resolveReportTargets } from './util.js';

const querySchema = z
	.strictObject({
		state: reportStateSchema.optional(),
		target_id: snowflakeSchema.optional(),
	})
	.extend(createPaginationQuerySchema(25, 100).shape);

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListReportsQuery = z.input<typeof querySchema>;

export interface ListReportsResult {
	nextCursor: number | null;
	reports: ReportWithUsers[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/reports',
	schema: { query: querySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListReportsResult> {
		const { cursor, limit, state, target_id } = req.query;
		const { guildId } = req.params;

		const db = getContext().db;

		const rows = await db<AutomoderatorReports[]>`
			SELECT * FROM automoderator_reports
			WHERE guild_id = ${guildId}
			${cursor ? db`AND id < ${cursor}` : db``}
			${state ? db`AND state = ${state as AutomoderatorReportState}` : db``}
			${target_id ? db`AND target_id = ${target_id}` : db``}
			ORDER BY id DESC
			LIMIT ${limit + 1}
		`;

		const hasNextPage = rows.length > limit;
		const page = hasNextPage ? rows.slice(0, limit) : rows;

		// One grouped count for the whole page rather than a correlated subquery per row: the page is at most
		// 100 ids, and this keeps the main query a plain index scan.
		const counts =
			page.length === 0
				? []
				: await db<{ count: string; reportId: number }[]>`
						SELECT report_id, count(*) FROM automoderator_reporters
						WHERE report_id IN ${db(page.map((row) => row.id))}
						GROUP BY report_id
					`;

		return {
			reports: await resolveReportTargets(page, new Map(counts.map((row) => [row.reportId, Number(row.count)]))),
			nextCursor: hasNextPage ? page.at(-1)!.id : null,
		};
	},
});
