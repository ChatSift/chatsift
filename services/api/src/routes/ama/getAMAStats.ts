import { getContext } from '@chatsift/backend-core';
import type { AmaQuestionState, AmaQuestionTagsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { QUESTION_STATES } from './constants.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export interface AMATagCount {
	count: number;
	id: AmaQuestionTagsId;
	name: string;
}

export interface AMAStats {
	byState: Record<AmaQuestionState, number>;
	/**
	 * Question count per custom tag in this session, ordered by tag name to match `tags/listTags.ts` (and
	 * therefore the Triage page's tag filter). Tags with no assignments are included at `0` rather than
	 * omitted -- an unused tag is exactly what a maintainer wants to see here.
	 */
	byTag: AMATagCount[];
	/**
	 * Total number of duplicate questions merged away into another question in this AMA (i.e. rows in
	 * `ama_question_askers` across every question still in this session) -- not itself a question count,
	 * so it's surfaced alongside `byState`/`total` rather than folded into either.
	 */
	mergedDuplicatesCount: number;
	total: number;
	/**
	 * Distinct people who asked at least one question in this session, counting every state (a denied or
	 * still-pending question was still asked by someone). Deliberately unaffected by merging: a merged-away
	 * question's author moves into `ama_question_askers`, so they keep counting as a participant even
	 * though `total` drops by one.
	 */
	uniqueAskerCount: number;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/stats',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	async handler(req): Promise<AMAStats> {
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [counts, [mergedDuplicates], [uniqueAskers], tagCounts] = await Promise.all([
			db<{ count: string; state: AmaQuestionState }[]>`
				SELECT state, COUNT(*) AS count FROM ama_questions WHERE ama_id = ${amaId} GROUP BY state
			`,
			db<{ count: string }[]>`
				SELECT COUNT(*) AS count FROM ama_question_askers a
				INNER JOIN ama_questions q ON q.id = a.question_id
				WHERE q.ama_id = ${amaId}
			`,
			// An asker id lives in two places -- on the question they authored, and (once their question is
			// merged away into a survivor) on `ama_question_askers`. `UNION` rather than `UNION ALL` so someone
			// appearing in both, or asking several times, still counts once.
			db<{ count: string }[]>`
				SELECT COUNT(*) AS count FROM (
					SELECT author_id FROM ama_questions WHERE ama_id = ${amaId}
					UNION
					SELECT a.author_id FROM ama_question_askers a
					INNER JOIN ama_questions q ON q.id = a.question_id
					WHERE q.ama_id = ${amaId}
				) AS askers
			`,
			// LEFT JOIN, so a tag nobody has used yet reports 0 instead of dropping out of the list entirely.
			db<{ count: string; id: AmaQuestionTagsId; name: string }[]>`
				SELECT t.id, t.name, COUNT(ta.question_id) AS count
				FROM ama_question_tags t
				LEFT JOIN ama_question_tag_assignments ta ON ta.tag_id = t.id
				WHERE t.ama_id = ${amaId}
				GROUP BY t.id, t.name
				ORDER BY t.name ASC
			`,
		]);

		const byState = Object.fromEntries(QUESTION_STATES.map((state) => [state, 0])) as Record<AmaQuestionState, number>;

		let total = 0;
		for (const { state, count } of counts) {
			const parsed = Number(count);
			byState[state] = parsed;
			total += parsed;
		}

		return {
			byState,
			byTag: tagCounts.map(({ id, name, count }) => ({ id, name, count: Number(count) })),
			mergedDuplicatesCount: Number(mergedDuplicates?.count ?? 0),
			total,
			uniqueAskerCount: Number(uniqueAskers?.count ?? 0),
		};
	},
});
