import { getContext } from '@chatsift/backend-core';
import { amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestionTags, AmaQuestionTagsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
	tagId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaQuestionTagsId),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/tags/:tagId',
	schema: {
		params: paramsSchema,
	},
	// Same gate as creating a tag: an AMA guest can already create tags and assign/unassign them across
	// every question in the session, so gating only deletion wouldn't protect anything they can't
	// already do by hand.
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	realtimeChannel: (req) => amaQuestionsChannel(req.params.guildId, req.params.amaId),
	async handler(req, res): Promise<void> {
		const { guildId, amaId, tagId } = req.params;
		const db = getContext().db;

		// The tag is only ever addressed by `ama_id` below, so this is what actually pins it to the guild
		// the caller is authed for -- without it, an id from someone else's AMA would delete just fine.
		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		// Assignments go with it -- `ama_question_tag_assignments_tag_fkey` is ON DELETE CASCADE.
		const [deleted] = await db<Pick<AmaQuestionTags, 'id'>[]>`
			DELETE FROM ama_question_tags WHERE id = ${tagId} AND ama_id = ${amaId}
			RETURNING id
		`;

		if (!deleted) {
			throw notFound('tag not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
