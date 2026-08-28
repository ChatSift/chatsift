import { getContext } from '@chatsift/backend-core';
import { automoderatorTriggerPunishmentsChannel, TRIGGER_PUNISHMENT_MAX_TRIGGERS } from '@chatsift/core';
import type { AutomoderatorTriggerPunishments } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	triggers: z.coerce.number().int().min(1).max(TRIGGER_PUNISHMENT_MAX_TRIGGERS),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/trigger-punishments/:triggers',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorTriggerPunishmentsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, triggers } = req.params;

		const [deleted] = await getContext().db<Pick<AutomoderatorTriggerPunishments, 'triggers'>[]>`
			DELETE FROM automoderator_trigger_punishments WHERE guild_id = ${guildId} AND triggers = ${triggers}
			RETURNING triggers
		`;

		if (!deleted) {
			throw notFound('trigger ladder step not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
