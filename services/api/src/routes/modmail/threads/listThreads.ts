import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const querySchema = z.strictObject({
	include_closed: z.stringbool().optional().default(false),
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListThreadsQuery = z.input<typeof querySchema>;

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/threads',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<Threads[]> {
		const { include_closed } = req.query;
		const { guildId } = req.params;

		const db = getContext().db;
		return db<Threads[]>`
			SELECT * FROM threads
			WHERE guild_id = ${guildId}
			${include_closed ? db`` : db`AND closed_at IS NULL`}
			ORDER BY id DESC
		`;
	},
});
