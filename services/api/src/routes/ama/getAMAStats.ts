import { getContext } from '@chatsift/backend-core';
import type { AmaQuestionState, AmaSessions, AmaSessionsId } from '@chatsift/db';
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

export interface AMAStats {
	byState: Record<AmaQuestionState, number>;
	/**
	 * Total number of duplicate questions merged away into another question in this AMA (i.e. rows in
	 * `ama_question_askers` across every question still in this session) -- not itself a question count,
	 * so it's surfaced alongside `byState`/`total` rather than folded into either.
	 */
	mergedDuplicatesCount: number;
	total: number;
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

		const [counts, [mergedDuplicates]] = await Promise.all([
			db<{ count: string; state: AmaQuestionState }[]>`
				SELECT state, COUNT(*) AS count FROM ama_questions WHERE ama_id = ${amaId} GROUP BY state
			`,
			db<{ count: string }[]>`
				SELECT COUNT(*) AS count FROM ama_question_askers a
				INNER JOIN ama_questions q ON q.id = a.question_id
				WHERE q.ama_id = ${amaId}
			`,
		]);

		const byState = Object.fromEntries(QUESTION_STATES.map((state) => [state, 0])) as Record<AmaQuestionState, number>;

		let total = 0;
		for (const { state, count } of counts) {
			const parsed = Number(count);
			byState[state] = parsed;
			total += parsed;
		}

		return { byState, mergedDuplicatesCount: Number(mergedDuplicates?.count ?? 0), total };
	},
});
