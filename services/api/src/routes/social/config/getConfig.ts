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
		// load, same as modmail's `getConfig.ts`. The three nulls below are the inert state described in
		// schema.sql: a guild only starts tracking XP once all of them are set.
		return (
			settings ?? {
				guildId: guildId as SocialGuildSettings['guildId'],
				requiredMessages: null,
				requiredMessagesTimespan: null,
				xpGain: null,
				requiredXpBase: null,
				requiredXpMultiplier: null,
				levelUpNotificationMode: 'NONE' as SocialGuildSettings['levelUpNotificationMode'],
				levelUpNotificationFallbackChannelId: null,
				levelUpNotificationMessage: null,
			}
		);
	},
});
