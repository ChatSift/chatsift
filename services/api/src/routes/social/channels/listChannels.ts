import { getContext } from '@chatsift/backend-core';
import type { SocialChannels } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListSocialChannelsResult = SocialChannels[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/channels',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ListSocialChannelsResult> {
		const { guildId } = req.params;

		// Only *configured* channels, not every channel in the guild -- the dashboard pairs this with its own
		// channel list (`GET /v3/guilds/:guildId` and friends) to render names, exactly like the AMA/ModMail
		// channel pickers do. Ordered by id purely for a stable list; there's nothing meaningful to sort on.
		return getContext().db<SocialChannels[]>`
			SELECT * FROM social_channels WHERE guild_id = ${guildId} ORDER BY channel_id
		`;
	},
});
