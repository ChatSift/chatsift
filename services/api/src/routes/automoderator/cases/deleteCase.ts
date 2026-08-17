import { getContext } from '@chatsift/backend-core';
import { automoderatorCasesChannel } from '@chatsift/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	caseId: z.coerce.number().int().positive(),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/cases/:caseId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorCasesChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { caseId, guildId } = req.params;

		const [deleted] = await getContext().db<{ caseId: number }[]>`
			DELETE FROM automoderator_cases WHERE guild_id = ${guildId} AND case_id = ${caseId} RETURNING case_id
		`;

		if (!deleted) {
			throw notFound('case not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
