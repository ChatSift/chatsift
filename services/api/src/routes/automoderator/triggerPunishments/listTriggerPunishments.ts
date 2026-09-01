import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorTriggerPunishments } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListTriggerPunishmentsResult = AutomoderatorTriggerPunishments[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/trigger-punishments',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListTriggerPunishmentsResult> {
		return getContext().db<AutomoderatorTriggerPunishments[]>`
			SELECT * FROM automoderator_trigger_punishments WHERE guild_id = ${req.params.guildId} ORDER BY triggers ASC
		`;
	},
});
