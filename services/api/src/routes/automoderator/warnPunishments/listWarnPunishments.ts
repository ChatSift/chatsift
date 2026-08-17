import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorWarnPunishments } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListWarnPunishmentsResult = AutomoderatorWarnPunishments[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/warn-punishments',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListWarnPunishmentsResult> {
		return getContext().db<AutomoderatorWarnPunishments[]>`
			SELECT * FROM automoderator_warn_punishments WHERE guild_id = ${req.params.guildId} ORDER BY warns ASC
		`;
	},
});
