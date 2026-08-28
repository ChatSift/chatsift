import { getContext } from '@chatsift/backend-core';
import { automoderatorAllowedInvitesChannel } from '@chatsift/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	allowedGuildId: snowflakeSchema,
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/allowed-invites/:allowedGuildId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorAllowedInvitesChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, allowedGuildId } = req.params;

		const deleted = await getContext().db`
			DELETE FROM automoderator_allowed_invites
			WHERE guild_id = ${guildId} AND allowed_guild_id = ${allowedGuildId}
		`;

		if (deleted.count === 0) {
			throw notFound('that server is not on the allowlist');
		}

		res.statusCode = 200;
		res.end();
	},
});
