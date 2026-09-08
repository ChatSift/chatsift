import { getContext } from '@chatsift/backend-core';
import type { UnappealableUsers } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveDiscordUser } from '../../../util/users.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface UnappealableUserWithUser {
	createdAt: Date;
	createdById: string;
	reason: string | null;
	user: APIUser | Snowflake;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/appeals/unappealable-users',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UnappealableUserWithUser[]> {
		const { guildId } = req.params;

		const rows = await getContext().db<UnappealableUsers[]>`
			SELECT * FROM unappealable_users WHERE guild_id = ${guildId} ORDER BY created_at DESC
		`;

		// Resolved through the Appeals bot's own token rather than `roundRobinAPI`, for the same reason
		// `modmail/blocks/listBlocks.ts` uses ModMail's: this is an Appeals-specific list, so there is no
		// "which installed bot should answer this" ambiguity. `users.get` is a global user lookup, not a
		// guild-member one, which matters here more than anywhere else -- everybody on this list is banned, so
		// none of them are members. `resolveDiscordUser` serves these from the shared cross-bot user cache, so a
		// long list doesn't spend one Discord request per row.
		const api = apiForGuild('APPEALS', guildId);
		return Promise.all(
			rows.map(async ({ userId, reason, createdById, createdAt }): Promise<UnappealableUserWithUser> => ({
				user: await resolveDiscordUser(api, userId),
				reason,
				createdById,
				createdAt,
			})),
		);
	},
});
