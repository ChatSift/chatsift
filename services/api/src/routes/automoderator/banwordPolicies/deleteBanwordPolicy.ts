import { getContext } from '@chatsift/backend-core';
import { automoderatorBanwordPoliciesChannel } from '@chatsift/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	policyId: z.coerce.number().int().positive(),
});

/**
 * Scoped by `guild_id` as well as the surrogate id, so a manager cannot delete another guild's policy by
 * guessing a number -- the same guard every other id-keyed delete in this product carries.
 */
export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/banword-policies/:policyId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorBanwordPoliciesChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, policyId } = req.params;

		const deleted = await getContext().db`
			DELETE FROM automoderator_banword_policies WHERE guild_id = ${guildId} AND id = ${policyId}
		`;

		if (deleted.count === 0) {
			throw notFound('no such policy');
		}

		res.statusCode = 200;
		res.end();
	},
});
