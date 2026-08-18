import { getContext, listReportMessages } from '@chatsift/backend-core';
import type { AutomoderatorReportMessages, AutomoderatorReporters, AutomoderatorReports } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { ReporterWithUser, ReportWithUsers } from './util.js';
import { resolveReporters, resolveReportTargets } from './util.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	reportId: z.coerce.number().int().positive(),
});

/**
 * How many reporters the detail view resolves. `report.reporterCount` still carries the real total, so the UI can
 * say how many are not shown -- a report gathering more than this is a brigade, and staff need the count more
 * than they need every name.
 */
const REPORTERS_LIMIT = 100;

export interface GetReportResult {
	/**
	 * The messages the reporter added beyond the one on the report itself, in their chosen order. Always
	 * present and always empty for a guild report -- only a DM draft (P3b) fills it.
	 */
	contextMessages: AutomoderatorReportMessages[];
	report: ReportWithUsers;
	/**
	 * At most {@link REPORTERS_LIMIT} of them, oldest first. Compare against `report.reporterCount` for the total.
	 */
	reporters: ReporterWithUser[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/reports/:reportId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<GetReportResult> {
		const { guildId, reportId } = req.params;
		const db = getContext().db;

		const [row] = await db<AutomoderatorReports[]>`
			SELECT * FROM automoderator_reports WHERE guild_id = ${guildId} AND id = ${reportId}
		`;

		if (!row) {
			throw notFound('report not found');
		}

		// Bounded, and the total comes from a `count(*)` rather than from the page's length. `resolveReporters`
		// does one user lookup per row: they share the redis cache `resolveDiscordUser` sits behind, but the
		// *first* view of a brigaded report would still serialize that many misses through Discord's
		// `GET /users/{id}` bucket (30 per 30s per token), stalling every other user lookup the API makes.
		// The list route is bounded by its pagination; this one had nothing.
		const [reporters, counted, contextMessages] = await Promise.all([
			db<AutomoderatorReporters[]>`
				SELECT * FROM automoderator_reporters
				WHERE report_id = ${row.id}
				ORDER BY created_at ASC
				LIMIT ${REPORTERS_LIMIT}
			`,
			db<{ count: string }[]>`
				SELECT count(*) FROM automoderator_reporters WHERE report_id = ${row.id}
			`,
			// Unbounded, unlike the reporters above: a draft is capped at `REPORT_DRAFT_MAX_MESSAGES` when it is
			// built, so this cannot grow the way a brigaded report's reporter list can.
			listReportMessages(row.id),
		]);

		const [report] = await resolveReportTargets([row], new Map([[row.id, Number(counted[0]?.count ?? 0)]]));

		return { report: report!, reporters: await resolveReporters(reporters), contextMessages };
	},
});
