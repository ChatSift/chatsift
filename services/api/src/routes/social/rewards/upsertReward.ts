import { getContext } from '@chatsift/backend-core';
import type { SocialRewards } from '@chatsift/db';
import { badRequest, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { fetchGuildRoles } from '../../../util/roles.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { upsertSocialRewardBodySchema } from '../schemas.js';

const bodySchema = upsertSocialRewardBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema, roleId: snowflakeSchema });

export type UpsertSocialRewardBody = z.input<typeof bodySchema>;
export type UpsertSocialRewardResult = SocialRewards;

/**
 * Upsert per role, matching legacy's `/reward create` (which was also an upsert): a role rewards exactly one
 * level, so re-submitting an existing role moves it rather than creating a second entry -- which is also what
 * the table's `(guild_id, role_id)` primary key enforces.
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/social/rewards/:roleId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpsertSocialRewardResult> {
		const { level, clean, description } = req.body;
		const { guildId, roleId } = req.params;

		// Stricter than `assertRolesBelongToGuild`: a reward role is one the bot has to *assign*, and a managed
		// role (another bot's integration role, a booster role, `@everyone`) can never be assigned by anyone --
		// configuring one would mean every level-up quietly failing. `fetchGuildRoles` already drops
		// `@everyone` for us, so a caller naming it lands on the "does not belong to this guild" branch.
		const roles = await fetchGuildRoles(guildId, 'SOCIAL');
		if (!roles) {
			// Same 500 `assertRolesBelongToGuild` raises for this branch, and for the same reason: the caller's
			// body may well be fine, we just couldn't reach Discord to find out -- a 400 would blame them for it.
			req.logger.warn({ guildId }, `Failed to fetch roles for guild ${guildId}`);
			throw internal();
		}

		const role = roles.find((entry) => entry.id === roleId);
		if (!role) {
			throw badRequest(`role ${roleId} does not belong to this guild`);
		}

		if (role.managed) {
			throw badRequest(`role ${roleId} is managed by an integration and cannot be assigned`);
		}

		const [reward] = await getContext().db<SocialRewards[]>`
			INSERT INTO social_rewards (guild_id, role_id, level, clean, description)
			VALUES (${guildId}, ${roleId}, ${level}, ${clean}, ${description})
			ON CONFLICT (guild_id, role_id) DO UPDATE SET
				level = EXCLUDED.level,
				clean = EXCLUDED.clean,
				description = EXCLUDED.description
			RETURNING *
		`;

		return reward!;
	},
});
