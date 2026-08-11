import { getContext } from '@chatsift/backend-core';
import type { SocialGuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetSocialConfigResult = SocialGuildSettings;

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/config',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<GetSocialConfigResult> {
		const { guildId } = req.params;

		const [settings] = await getContext().db<SocialGuildSettings[]>`
			SELECT * FROM social_guild_settings WHERE guild_id = ${guildId}
		`;

		// No row yet is the common case (a guild that has never configured Social) -- return the same shape a
		// fresh row would have instead of 404ing, so the dashboard config screen renders defaults on first
		// load, same as modmail's `getConfig.ts`. This is the inert state described in schema.sql: a guild
		// only starts tracking XP once `requiredMessages`, `requiredMessagesTimespan` and `xpGain` are all
		// set (the other nulls below are just unconfigured, not part of that gate).
		const defaults: SocialGuildSettings = {
			guildId: guildId as SocialGuildSettings['guildId'],
			requiredMessages: null,
			requiredMessagesTimespan: null,
			xpGain: null,
			requiredXpBase: null,
			requiredXpMultiplier: null,
			// Kanel generates the enum as a TS `enum`, which `@chatsift/db` re-exports type-only -- so there's no
			// member to reference here and a bare literal isn't assignable to it. The annotation above is what
			// actually checks this object; the cast only bridges that.
			levelUpNotificationMode: 'NONE' as SocialGuildSettings['levelUpNotificationMode'],
			levelUpNotificationFallbackChannelId: null,
			levelUpNotificationMessage: null,
		};

		return settings ?? defaults;
	},
});
