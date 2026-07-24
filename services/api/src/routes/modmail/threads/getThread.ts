import { getContext } from '@chatsift/backend-core';
import type { ThreadMessages, Threads, ThreadsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	threadId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as ThreadsId),
});

export interface ThreadDetail extends Threads {
	messages: ThreadMessages[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/threads/:threadId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ThreadDetail> {
		const { guildId, threadId } = req.params;
		const db = getContext().db;

		const [thread] = await db<Threads[]>`
			SELECT * FROM threads WHERE id = ${threadId} AND guild_id = ${guildId}
		`;

		if (!thread) {
			throw notFound('thread not found');
		}

		const messages = await db<ThreadMessages[]>`
			SELECT * FROM thread_messages WHERE thread_id = ${threadId} ORDER BY local_thread_message_id
		`;

		return { ...thread, messages };
	},
});
