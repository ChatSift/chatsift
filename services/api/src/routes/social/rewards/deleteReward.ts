import { getContext } from '@chatsift/backend-core';
import type { SocialRewards } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema, roleId: snowflakeSchema });

/**
 * Only stops the role being *granted* going forward -- members who already earned it keep it, exactly like
 * legacy's `/reward delete`. The bot never strips a role it no longer knows about (its role diffing only ever
 * removes superseded `clean` tiers it can still see configured), so unrewarding a role is deliberately not
 * retroactive; taking it back off everyone is a Discord-side job.
 */
export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/social/rewards/:roleId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, roleId } = req.params;

		const [deleted] = await getContext().db<Pick<SocialRewards, 'roleId'>[]>`
			DELETE FROM social_rewards WHERE guild_id = ${guildId} AND role_id = ${roleId}
			RETURNING role_id
		`;

		if (!deleted) {
			throw notFound('reward not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
