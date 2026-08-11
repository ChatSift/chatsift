import { getContext } from '@chatsift/backend-core';
import type { SocialRoles } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListSocialRolesResult = SocialRoles[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/social/roles',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ListSocialRolesResult> {
		const { guildId } = req.params;

		return getContext().db<SocialRoles[]>`
			SELECT * FROM social_roles WHERE guild_id = ${guildId} ORDER BY role_id
		`;
	},
});
