import { getContext } from '@chatsift/backend-core';
import type { ThreadMessageContentEdits, ThreadMessagesId, ThreadsId } from '@chatsift/db';
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
	messageId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as ThreadMessagesId),
});

export interface ThreadMessageEdit {
	editedAt: Date;
	oldContent: string;
}

export interface ThreadMessageEditsResult {
	edits: ThreadMessageEdit[];
}

/**
 * On-demand fetch for a recorded message's prior versions (Phase 3, #261) -- kept out of `getThread.ts`'s
 * own response (which only carries an `editCount`) so a page of messages nobody clicks the "edited" badge
 * on doesn't pay for every version of every edited message up front.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/threads/:threadId/messages/:messageId/edits',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<ThreadMessageEditsResult> {
		const { guildId, threadId, messageId } = req.params;
		const db = getContext().db;

		const [message] = await db<{ id: ThreadMessagesId }[]>`
			SELECT tm.id FROM thread_messages tm
			JOIN threads t ON t.id = tm.thread_id
			WHERE tm.id = ${messageId} AND tm.thread_id = ${threadId} AND t.guild_id = ${guildId}
		`;

		if (!message) {
			throw notFound('message not found');
		}

		const edits = await db<ThreadMessageContentEdits[]>`
			SELECT * FROM thread_message_content_edits WHERE thread_message_id = ${messageId} ORDER BY edited_at DESC
		`;

		return {
			edits: edits.map((edit) => ({ editedAt: edit.editedAt, oldContent: edit.oldContent })),
		};
	},
});
