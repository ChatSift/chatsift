import { getContext } from '@chatsift/backend-core';
import type { SocialInteractions } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListSocialInteractionsResult = SocialInteractions[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/interactions',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ListSocialInteractionsResult> {
		const { guildId } = req.params;

		// `commandId` is part of the row and deliberately surfaced: a `null` there is exactly what the
		// dashboard's "needs a resync" affordance keys off (every migrated row starts that way, see
		// docs/roadmap/10-social-port.md ledger item 3).
		return getContext().db<SocialInteractions[]>`
			SELECT * FROM social_interactions WHERE guild_id = ${guildId} ORDER BY name
		`;
	},
});
