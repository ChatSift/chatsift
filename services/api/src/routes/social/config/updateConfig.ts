import { getContext } from '@chatsift/backend-core';
import type { SocialGuildSettings } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelIsPostable } from '../../../util/channels.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateSocialConfigBodySchema } from '../schemas.js';

const bodySchema = updateSocialConfigBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type UpdateSocialConfigBody = z.input<typeof bodySchema>;
export type UpdateSocialConfigResult = SocialGuildSettings;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/social/config',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateSocialConfigResult> {
		const data = req.body;
		const { guildId } = req.params;
		const db = getContext().db;

		// Only validated when actually being set -- clearing it (`null`) is always fine, and a fallback that
		// has since been deleted on Discord's side is the bot's problem to self-heal (it nulls the column
		// itself when a send fails), not something to block an unrelated config edit on.
		if (data.levelUpNotificationFallbackChannelId) {
			await assertChannelIsPostable(guildId, data.levelUpNotificationFallbackChannelId, 'SOCIAL', req.logger);
		}

		const columns = Object.keys(data) as (keyof typeof data)[];

		const [settings] = await db<SocialGuildSettings[]>`
			INSERT INTO social_guild_settings (
				guild_id, required_messages, required_messages_timespan, xp_gain, required_xp_base,
				required_xp_multiplier, level_up_notification_mode, level_up_notification_fallback_channel_id,
				level_up_notification_message
			)
			VALUES (
				${guildId}, ${data.requiredMessages ?? null}, ${data.requiredMessagesTimespan ?? null},
				${data.xpGain ?? null}, ${data.requiredXpBase ?? null}, ${data.requiredXpMultiplier ?? null},
				${data.levelUpNotificationMode ?? 'NONE'}, ${data.levelUpNotificationFallbackChannelId ?? null},
				${data.levelUpNotificationMessage ?? null}
			)
			ON CONFLICT (guild_id) DO UPDATE SET ${db(data, ...columns)}
			RETURNING *
		`;

		return settings!;
	},
});
