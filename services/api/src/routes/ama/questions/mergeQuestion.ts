import { getContext } from '@chatsift/backend-core';
import { amaQuestionsChannel, MERGE_SOURCE_STATES, MERGE_TARGET_STATES } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { badRequest, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { mergeDuplicatesIntoOriginal } from './mergeShared.js';

const bodySchema = z.strictObject({
	intoQuestionId: z.number().int().positive(),
});
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
	questionId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaQuestionsId),
});

export type MergeQuestionBody = z.input<typeof bodySchema>;
export type MergeQuestionResult = AmaQuestions;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions/:questionId/merge',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	realtimeChannel: (req) => amaQuestionsChannel(req.params.guildId, req.params.amaId),
	async handler(req): Promise<MergeQuestionResult> {
		const { guildId, amaId, questionId: duplicateId } = req.params;
		const { intoQuestionId: originalId } = req.body;
		const db = getContext().db;

		if (originalId === duplicateId) {
			throw badRequest('a question cannot be a duplicate of itself');
		}

		const [session] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [duplicate] = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${duplicateId} AND ama_id = ${amaId}
		`;
		const [original] = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${originalId} AND ama_id = ${amaId}
		`;

		if (!duplicate || !original) {
			throw notFound('both questions must belong to this AMA');
		}

		if (!MERGE_SOURCE_STATES.has(duplicate.state)) {
			throw badRequest(`cannot merge away a question in state ${duplicate.state}`);
		}

		// The target's bar is lower than the duplicate's (#328): absorbing an asker is non-destructive, so
		// it stays legal while a guest is writing the answer and after the question has gone public (the
		// live embed's merged-asker count is re-rendered in place). Only DENIED is refused -- folding a new
		// asker in there would quietly undo a mod's decision.
		if (!MERGE_TARGET_STATES.has(original.state)) {
			throw badRequest(`cannot merge into a question in state ${original.state}`);
		}

		return mergeDuplicatesIntoOriginal(guildId, session, original, [duplicate]);
	},
});
