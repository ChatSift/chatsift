import { getContext } from '@chatsift/backend-core';
import type { DashboardGrants } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { roundRobinAPI } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface GetGrantsResult {
	users: (APIUser | Snowflake)[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/grants',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<GetGrantsResult> {
		const { guildId } = req.params;

		const grants = await getContext().db<Pick<DashboardGrants, 'userId'>[]>`
			SELECT user_id FROM dashboard_grants WHERE guild_id = ${guildId}
		`;

		const api = roundRobinAPI(req.guild!);
		const users = await Promise.all(
			grants.map(async ({ userId }) => {
				try {
					return await api.users.get(userId);
				} catch (error) {
					if (error instanceof DiscordAPIError && error.status === 404) {
						return userId;
					}

					throw error;
				}
			}),
		);

		return { users };
	},
});
