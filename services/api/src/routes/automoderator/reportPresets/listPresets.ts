import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReportPresets } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListReportPresetsResult = AutomoderatorReportPresets[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/report-presets',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListReportPresetsResult> {
		// Ordered by id, not alphabetically: the reason picker lists them in this order, and a guild that adds
		// its most-used reason first expects it at the top rather than wherever the alphabet puts it.
		return getContext().db<AutomoderatorReportPresets[]>`
			SELECT * FROM automoderator_report_presets WHERE guild_id = ${req.params.guildId} ORDER BY id ASC
		`;
	},
});
