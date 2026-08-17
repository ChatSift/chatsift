import { getContext } from '@chatsift/backend-core';
import { automoderatorWarnPunishmentsChannel, WARN_PUNISHMENT_MAX_WARNS } from '@chatsift/core';
import type { AutomoderatorWarnPunishments } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	warns: z.coerce.number().int().min(1).max(WARN_PUNISHMENT_MAX_WARNS),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/warn-punishments/:warns',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorWarnPunishmentsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, warns } = req.params;

		const [deleted] = await getContext().db<Pick<AutomoderatorWarnPunishments, 'warns'>[]>`
			DELETE FROM automoderator_warn_punishments WHERE guild_id = ${guildId} AND warns = ${warns}
			RETURNING warns
		`;

		if (!deleted) {
			throw notFound('warn ladder step not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
