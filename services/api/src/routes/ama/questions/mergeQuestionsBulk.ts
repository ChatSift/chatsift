import { getContext } from '@chatsift/backend-core';
import { amaPublicAnswersChannel, amaQuestionsChannel, MERGE_SOURCE_STATES, MERGE_TARGET_STATES } from '@chatsift/core';
import type { AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { badRequest, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { mergeDuplicatesIntoOriginal } from './mergeShared.js';

// Caps roughly matching the dashboard's own bulk-selection UI (`QuestionsList.tsx`'s "Select
// Duplicates" mode) -- there's no realistic case for merging hundreds of questions in one request.
const bodySchema = z.strictObject({
	intoQuestionId: z.number().int().positive(),
	questionIds: z.array(z.number().int().positive()).min(1).max(100),
});
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type MergeQuestionsBulkBody = z.input<typeof bodySchema>;
export type MergeQuestionsBulkResult = AmaQuestions;

/**
 * Bulk counterpart to `mergeQuestion.ts` (#293 follow-up, requested after the fact -- the owner wants to
 * select a batch of near-identical questions from the list and merge them all into one original in a
 * single action instead of repeating the single-question flow one at a time). Same underlying DB/Discord
 * side effects, just applied to every duplicate in one transaction plus one final message refresh.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions/merge-bulk',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	// Two audiences: the dashboard's question list, and the public answers page (#323) -- `MERGE_TARGET_STATES`
	// includes `ASKED`, so a merge can rewrite a question that page is already showing.
	realtimeChannel: (req) => [
		amaQuestionsChannel(req.params.guildId, req.params.amaId),
		amaPublicAnswersChannel(req.params.amaId),
	],
	async handler(req): Promise<MergeQuestionsBulkResult> {
		const { guildId, amaId } = req.params;
		const { intoQuestionId: originalId, questionIds } = req.body;
		const db = getContext().db;

		const duplicateIds = [...new Set(questionIds)].filter((id) => id !== originalId) as AmaQuestionsId[];

		if (duplicateIds.length === 0) {
			throw badRequest('a question cannot be a duplicate of itself, and at least one other question is required');
		}

		const [session] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [original] = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${originalId} AND ama_id = ${amaId}
		`;

		if (!original) {
			throw notFound('the target question was not found in this AMA');
		}

		// The target's bar is lower than the duplicates' (#328) -- see `mergeQuestion.ts` for why.
		if (!MERGE_TARGET_STATES.has(original.state)) {
			throw badRequest(`cannot merge into a question in state ${original.state}`);
		}

		const duplicates = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ANY(${duplicateIds}) AND ama_id = ${amaId}
		`;

		if (duplicates.length !== duplicateIds.length) {
			throw notFound('one or more selected questions were not found in this AMA');
		}

		const unmergeable = duplicates.filter((duplicate) => !MERGE_SOURCE_STATES.has(duplicate.state));
		if (unmergeable.length > 0) {
			throw badRequest(
				`cannot merge away question(s) #${unmergeable.map((question) => question.id).join(', #')} -- ` +
					`they're in a state (${[...new Set(unmergeable.map((question) => question.state))].join(', ')}) that's no longer mergeable`,
			);
		}

		return mergeDuplicatesIntoOriginal(guildId, session, original, duplicates);
	},
});
