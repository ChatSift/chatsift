import { getContext } from '@chatsift/backend-core';
import type { DashboardGrants } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';

const bodySchema = z.strictObject({
	userId: snowflakeSchema,
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type DeleteGrantBody = z.input<typeof bodySchema>;

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/grants',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res) {
		const { userId } = req.body;
		const { guildId } = req.params;

		const [deleted] = await getContext().db<Pick<DashboardGrants, 'id'>[]>`
			DELETE FROM dashboard_grants WHERE guild_id = ${guildId} AND user_id = ${userId}
			RETURNING id
		`;

		if (!deleted) {
			throw notFound('grant not found for this user');
		}

		res.statusCode = 200;
		res.end();
	},
});
