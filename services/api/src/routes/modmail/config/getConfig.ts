import { getContext, GRANTS } from '@chatsift/backend-core';
import type { GuildSettings } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveUserBestEffort } from '../threads/util.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface GetModmailConfigResult extends GuildSettings {
	/**
	 * Resolved from `recordThreadContentEnabledBy` for the dashboard's audit line -- raw snowflakes aren't
	 * friendly to show directly (#261). `null` when recording was never enabled; otherwise the full
	 * `APIUser`, or the bare snowflake on a 404 (e.g. a deleted account), same resolve-or-fallback shape
	 * `routes/modmail/threads/util.ts#resolveUser` uses everywhere else.
	 */
	recordThreadContentEnabledByUser: APIUser | Snowflake | null;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/config',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
		grants: [GRANTS.MODMAIL_CONFIG_UPDATE],
	}),
	async handler(req): Promise<GetModmailConfigResult> {
		const { guildId } = req.params;

		const [settings] = await getContext().db<GuildSettings[]>`
			SELECT * FROM guild_settings WHERE guild_id = ${guildId}
		`;

		// No row yet is the common case (a guild that hasn't configured ModMail) -- return the same shape a fresh
		// row would have instead of 404ing, so the dashboard config screen can render defaults on first load.
		const resolved: GuildSettings = settings ?? {
			guildId: guildId as GuildSettings['guildId'],
			modForumId: null,
			defaultGreetingMessage: null,
			farewellMessage: null,
			simpleMode: false,
			alertRoleId: null,
			anonReplyLabel: null,
			maxConcurrentThreads: 1,
			nukeDelayMinutes: null,
			greetingBeforeOpener: false,
			recordThreadContent: false,
			recordThreadContentEnabledBy: null,
			recordThreadContentEnabledAt: null,
		};

		return {
			...resolved,
			recordThreadContentEnabledByUser: resolved.recordThreadContentEnabledBy
				? await resolveUserBestEffort(guildId, resolved.recordThreadContentEnabledBy, req.logger)
				: null,
		};
	},
});
