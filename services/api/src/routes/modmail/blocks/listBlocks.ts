import { getContext } from '@chatsift/backend-core';
import type { Blocks } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIModmail } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ModmailBlockWithUser {
	expiresAt: Date | null;
	user: APIUser | Snowflake;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/blocks',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ModmailBlockWithUser[]> {
		const { guildId } = req.params;

		const rows = await getContext().db<Blocks[]>`
			SELECT * FROM blocks WHERE guild_id = ${guildId} ORDER BY user_id
		`;

		// Always resolved via the ModMail bot's own token directly (not `roundRobinAPI`) -- a block is a
		// ModMail-specific concept, so there's no "which installed bot should answer this" ambiguity the way
		// there is for guild-wide grants. `users.get` is a global user lookup, not a guild-member lookup, so
		// this still works even for a guild the ModMail bot was since kicked from.
		return Promise.all(
			rows.map(async ({ userId, expiresAt }): Promise<ModmailBlockWithUser> => {
				try {
					const user = await discordAPIModmail.users.get(userId);
					return { user, expiresAt };
				} catch (error) {
					if (error instanceof DiscordAPIError && error.status === 404) {
						return { user: userId, expiresAt };
					}

					throw error;
				}
			}),
		);
	},
});
