import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReporters, AutomoderatorReports } from '@chatsift/db';
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

export interface GetReportResult {
	report: ReportWithUsers;
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

		const reporters = await db<AutomoderatorReporters[]>`
			SELECT * FROM automoderator_reporters WHERE report_id = ${row.id} ORDER BY created_at ASC
		`;

		const [report] = await resolveReportTargets([row], new Map([[row.id, reporters.length]]));

		return { report: report!, reporters: await resolveReporters(reporters) };
	},
});
