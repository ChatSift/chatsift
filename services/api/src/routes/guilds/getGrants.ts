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

export interface Grant {
	createdAt: Date;
	createdBy: APIUser | Snowflake;
	user: APIUser | Snowflake;
}

export interface GetGrantsResult {
	grants: Grant[];
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

		const rows = await getContext().db<Pick<DashboardGrants, 'createdAt' | 'createdById' | 'userId'>[]>`
			SELECT user_id, created_by_id, created_at FROM dashboard_grants WHERE guild_id = ${guildId}
		`;

		// A user can manage a guild (and thus reach this route) without any of our bots being in it -- e.g. grants
		// left over from before the bot was kicked. `roundRobinAPI` requires at least one bot to pick from, so
		// fall back to the raw snowflake instead of resolving via Discord, same as the 404-below-user case.
		const api = req.guild!.bots.length > 0 ? roundRobinAPI(req.guild!) : undefined;
		const resolveCache = new Map<Snowflake, Promise<APIUser | Snowflake>>();
		const resolveUser = async (userId: Snowflake): Promise<APIUser | Snowflake> => {
			const cached = resolveCache.get(userId);
			if (cached) {
				return cached;
			}

			const promise = (async () => {
				if (!api) {
					return userId;
				}

				try {
					return await api.users.get(userId);
				} catch (error) {
					if (error instanceof DiscordAPIError && error.status === 404) {
						return userId;
					}

					throw error;
				}
			})();

			resolveCache.set(userId, promise);
			return promise;
		};

		const grants = await Promise.all(
			rows.map(async ({ userId, createdById, createdAt }) => {
				const [user, createdBy] = await Promise.all([resolveUser(userId), resolveUser(createdById)]);
				return { user, createdBy, createdAt };
			}),
		);

		return { grants };
	},
});
