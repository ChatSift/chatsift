import { getContext } from '@chatsift/backend-core';
import { appealsUnappealableUsersChannel } from '@chatsift/core';
import type { UnappealableUsers } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { deleteUnappealableUserBodySchema } from '../schemas.js';

const bodySchema = deleteUnappealableUserBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type DeleteUnappealableUserBody = z.input<typeof bodySchema>;

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/appeals/unappealable-users',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	realtimeChannel: (req) => appealsUnappealableUsersChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { userId } = req.body;
		const { guildId } = req.params;

		const [deleted] = await getContext().db<Pick<UnappealableUsers, 'userId'>[]>`
			DELETE FROM unappealable_users WHERE guild_id = ${guildId} AND user_id = ${userId}
			RETURNING user_id
		`;

		if (!deleted) {
			throw notFound('that user is not marked unappealable in this guild');
		}

		res.statusCode = 200;
		res.end();
	},
});
