import { getContext } from '@chatsift/backend-core';
import type { SocialRoles } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema, roleId: snowflakeSchema });

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/social/roles/:roleId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, roleId } = req.params;

		const [deleted] = await getContext().db<Pick<SocialRoles, 'roleId'>[]>`
			DELETE FROM social_roles WHERE guild_id = ${guildId} AND role_id = ${roleId}
			RETURNING role_id
		`;

		if (!deleted) {
			throw notFound('role is not configured');
		}

		res.statusCode = 200;
		res.end();
	},
});
