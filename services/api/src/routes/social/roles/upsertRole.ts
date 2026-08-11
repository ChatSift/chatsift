import { getContext } from '@chatsift/backend-core';
import type { SocialRoles } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertRolesBelongToGuild } from '../../../util/roles.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { upsertSocialRoleBodySchema } from '../schemas.js';

const bodySchema = upsertSocialRoleBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema, roleId: snowflakeSchema });

export type UpsertSocialRoleBody = z.input<typeof bodySchema>;
export type UpsertSocialRoleResult = SocialRoles;

/**
 * Full-representation PUT, same as the channel one. Note this is the *multiplier* table, unrelated to
 * `social_rewards` -- the same role can legitimately appear in both (a reward role that also boosts XP).
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/social/roles/:roleId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpsertSocialRoleResult> {
		const { multiplier } = req.body;
		const { guildId, roleId } = req.params;

		await assertRolesBelongToGuild(guildId, [roleId], 'SOCIAL', req.logger);

		const [role] = await getContext().db<SocialRoles[]>`
			INSERT INTO social_roles (guild_id, role_id, multiplier)
			VALUES (${guildId}, ${roleId}, ${multiplier})
			ON CONFLICT (guild_id, role_id) DO UPDATE SET multiplier = EXCLUDED.multiplier
			RETURNING *
		`;

		return role!;
	},
});
