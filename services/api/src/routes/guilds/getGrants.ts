import { getContext } from '@chatsift/backend-core';
import type { DashboardGrants } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { roundRobinAPI } from '../../util/discordAPI.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { resolveDiscordUser } from '../../util/users.js';

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
		//
		// The per-request de-dup map this used to keep is gone: `resolveDiscordUser` de-dups in-flight fetches
		// for the same id process-wide (and answers repeat ids straight out of the shared cache), which covers
		// the same-user-twice case this was written for and then some.
		const hasBots = req.guild!.bots.length > 0;
		const resolveUser = async (userId: Snowflake): Promise<APIUser | Snowflake> =>
			hasBots ? resolveDiscordUser(roundRobinAPI(req.guild!), userId) : userId;

		const grants = await Promise.all(
			rows.map(async ({ userId, createdById, createdAt }) => {
				const [user, createdBy] = await Promise.all([resolveUser(userId), resolveUser(createdById)]);
				return { user, createdBy, createdAt };
			}),
		);

		return { grants };
	},
});
