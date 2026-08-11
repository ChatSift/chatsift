import { getContext } from '@chatsift/backend-core';
import type { SocialChannels } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../../util/channels.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { upsertSocialChannelBodySchema } from '../schemas.js';

const bodySchema = upsertSocialChannelBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema, channelId: snowflakeSchema });

export type UpsertSocialChannelBody = z.input<typeof bodySchema>;
export type UpsertSocialChannelResult = SocialChannels;

/**
 * A full-representation PUT (see the body schema's own comment): the body is this channel's complete
 * configurable state, so an omitted field resets to its default rather than being left as it was.
 *
 * Only guild membership is validated, deliberately not the channel's *type*. Legacy's `/channel` command
 * restricted its option to categories/text/forum/voice/public-threads, but that was a slash-command picker
 * affordance, not a rule the engine needs: a row here is matched against a message's channel (or its parent
 * category, or a thread parent's parent), so any channel type that can carry a message is legitimate --
 * including ones Discord adds later.
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/social/channels/:channelId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpsertSocialChannelResult> {
		const { ignored, multiplier } = req.body;
		const { guildId, channelId } = req.params;

		await assertChannelsBelongToGuild(guildId, [channelId], 'SOCIAL', req.logger);

		const [channel] = await getContext().db<SocialChannels[]>`
			INSERT INTO social_channels (guild_id, channel_id, ignored, multiplier)
			VALUES (${guildId}, ${channelId}, ${ignored}, ${multiplier})
			ON CONFLICT (guild_id, channel_id) DO UPDATE SET
				ignored = EXCLUDED.ignored,
				multiplier = EXCLUDED.multiplier
			RETURNING *
		`;

		return channel!;
	},
});
