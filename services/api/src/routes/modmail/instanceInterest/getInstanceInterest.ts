import { getContext } from '@chatsift/backend-core';
import type { ModmailInstanceInterest } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveUserBestEffort } from '../threads/util.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface ModmailInstanceInterestEntry {
	createdAt: Date;
	/**
	 * Whoever pressed the button, for the card's "registered by" line -- a co-manager finding the upsell
	 * already spent deserves to know who spent it. Bare snowflake if Discord 404s the account, same
	 * resolve-or-fallback shape every other user display here uses.
	 */
	user: APIUser | Snowflake;
}

export interface GetModmailInstanceInterestResult {
	/**
	 * Wrapped rather than returned bare because a handler resolving to `null` is serialized as a 204 with no
	 * body (see `core/server.ts`), which reaches react-query as `undefined` and throws there.
	 */
	interest: ModmailInstanceInterestEntry | null;
}

/**
 * Whether this guild has already registered interest in a custom ModMail instance (#216). Backs the upsell
 * card on the ModMail dashboard root, which flips to a spent state rather than offering the button again --
 * the row can never be removed, so re-offering it would only invite a second press that does nothing.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/instance-interest',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<GetModmailInstanceInterestResult> {
		const { guildId } = req.params;

		const [row] = await getContext().db<ModmailInstanceInterest[]>`
			SELECT * FROM modmail_instance_interest WHERE guild_id = ${guildId}
		`;

		if (!row) {
			return { interest: null };
		}

		return {
			interest: {
				createdAt: row.createdAt,
				user: await resolveUserBestEffort(guildId, row.userId, req.logger),
			},
		};
	},
});
