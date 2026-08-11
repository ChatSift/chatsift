import { getContext } from '@chatsift/backend-core';
import type { SocialChannels } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema, channelId: snowflakeSchema });

/**
 * Removes a channel's configuration entirely, which is different from setting it back to the defaults: no row
 * means the channel neither silences anything nor contributes a multiplier, and (since a row can stand in for
 * a whole category) it stops shadowing whatever its own parent category configures.
 */
export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/social/channels/:channelId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, channelId } = req.params;

		const [deleted] = await getContext().db<Pick<SocialChannels, 'channelId'>[]>`
			DELETE FROM social_channels WHERE guild_id = ${guildId} AND channel_id = ${channelId}
			RETURNING channel_id
		`;

		if (!deleted) {
			throw notFound('channel is not configured');
		}

		res.statusCode = 200;
		res.end();
	},
});
