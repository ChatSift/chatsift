import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReportPrompts } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/report-prompts',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<AutomoderatorReportPrompts[]> {
		return getContext().db<AutomoderatorReportPrompts[]>`
			SELECT * FROM automoderator_report_prompts WHERE guild_id = ${req.params.guildId} ORDER BY id
		`;
	},
});
