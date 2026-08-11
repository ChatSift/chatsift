import { getContext } from '@chatsift/backend-core';
import type { SocialRewards } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListSocialRewardsResult = SocialRewards[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/rewards',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ListSocialRewardsResult> {
		const { guildId } = req.params;

		// By level, which is how a rewards ladder reads (and how the bot walks it) -- unlike the two
		// multiplier tables above, this one has a meaningful order.
		return getContext().db<SocialRewards[]>`
			SELECT * FROM social_rewards WHERE guild_id = ${guildId} ORDER BY level, role_id
		`;
	},
});
