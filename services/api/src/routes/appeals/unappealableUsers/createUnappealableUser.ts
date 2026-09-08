import { getContext } from '@chatsift/backend-core';
import { appealsUnappealableUsersChannel } from '@chatsift/core';
import type { UnappealableUsers } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { createUnappealableUserBodySchema } from '../schemas.js';

const bodySchema = createUnappealableUserBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateUnappealableUserBody = z.input<typeof bodySchema>;
export type CreateUnappealableUserResult = UnappealableUsers;

export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/appeals/unappealable-users',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	realtimeChannel: (req) => appealsUnappealableUsersChannel(req.params.guildId),
	async handler(req): Promise<CreateUnappealableUserResult> {
		const { userId, reason } = req.body;
		const { guildId } = req.params;

		// `PUT` and an upsert, mirroring `modmail/blocks/createBlock.ts`: re-marking somebody already on the
		// list is a moderator amending the reason, not an error worth a 409. `created_by_id` follows the reason
		// -- whoever last stated why is who the list should credit.
		const [row] = await getContext().db<UnappealableUsers[]>`
			INSERT INTO unappealable_users (guild_id, user_id, reason, created_by_id)
			VALUES (${guildId}, ${userId}, ${reason ?? null}, ${req.tokens.access.sub})
			ON CONFLICT (guild_id, user_id) DO UPDATE SET
				reason = EXCLUDED.reason,
				created_by_id = EXCLUDED.created_by_id
			RETURNING *
		`;

		return row!;
	},
});
