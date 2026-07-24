import { getContext } from '@chatsift/backend-core';
import type { Blocks } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { createBlockBodySchema } from '../schemas.js';

const bodySchema = createBlockBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateBlockBody = z.input<typeof bodySchema>;
export type CreateBlockResult = Blocks;

export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/modmail/blocks',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<CreateBlockResult> {
		const { userId, expiresAt } = req.body;
		const { guildId } = req.params;

		const [block] = await getContext().db<Blocks[]>`
			INSERT INTO blocks (user_id, guild_id, expires_at)
			VALUES (${userId}, ${guildId}, ${expiresAt ?? null})
			ON CONFLICT (user_id, guild_id) DO UPDATE SET expires_at = EXCLUDED.expires_at
			RETURNING *
		`;

		return block!;
	},
});
