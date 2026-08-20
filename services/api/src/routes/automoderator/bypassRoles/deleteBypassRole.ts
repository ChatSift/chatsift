import { getContext } from '@chatsift/backend-core';
import { automoderatorBypassRolesChannel } from '@chatsift/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	roleId: snowflakeSchema,
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/bypass-roles/:roleId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorBypassRolesChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, roleId } = req.params;

		const deleted = await getContext().db`
			DELETE FROM automoderator_bypass_roles WHERE guild_id = ${guildId} AND role_id = ${roleId}
		`;

		if (deleted.count === 0) {
			throw notFound('that role is not a bypass role');
		}

		res.statusCode = 200;
		res.end();
	},
});
