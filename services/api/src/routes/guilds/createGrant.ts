import { getContext } from '@chatsift/backend-core';
import type { DashboardGrants } from '@chatsift/db';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { roundRobinAPI } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';

const bodySchema = z.strictObject({
	userId: snowflakeSchema,
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateGrantBody = z.input<typeof bodySchema>;

export default defineRoute({
	method: 'put',
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

		try {
			await roundRobinAPI(req.guild!).users.get(userId);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				throw notFound('user not found');
			}

			throw error;
		}

		const [grant] = await getContext().db<Pick<DashboardGrants, 'id'>[]>`
			INSERT INTO dashboard_grants (guild_id, user_id, created_by_id)
			VALUES (${guildId}, ${userId}, ${req.tokens!.access.sub})
			ON CONFLICT (guild_id, user_id) DO NOTHING
			RETURNING id
		`;

		if (!grant) {
			throw badData('grant already exists for this user');
		}

		res.statusCode = 200;
		res.end();
	},
});
