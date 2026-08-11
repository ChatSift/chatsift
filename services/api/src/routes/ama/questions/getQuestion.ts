import { getContext } from '@chatsift/backend-core';
import type { AmaQuestionAskers, AmaQuestions, AmaQuestionsId, AmaSessions, AmaSessionsId } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { QuestionTagInfo } from './listQuestions.js';
import { resolveAmaUser } from './util.js';

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

export interface ExtraAsker {
	author: APIUser | Snowflake;
	/**
	 * The duplicate's original question text, snapshotted at merge time (see `ama_question_askers`).
	 * `null` for rows merged before this column existed -- that content was already destroyed by the
	 * merge's delete, unrecoverably.
	 */
	content: string | null;
	mergedAt: Date;
}

export interface QuestionDetail extends AmaQuestions {
	/**
	 * Resolved `answeredById`, null when nothing has been recorded yet. Resolved here rather than left to
	 * the dashboard, which used to match the raw id against `ama.guests` and could therefore only ever
	 * name a *guest* -- an AMA with no guests configured (or one answered by a plain moderator, which is
	 * what "Default (you)" records) rendered a bare snowflake with no avatar. The public answers page has
	 * always resolved it server-side; this brings the dashboard in line.
	 */
	answeredBy: APIUser | Snowflake | null;
	author: APIUser | Snowflake;
	extraAskers: ExtraAsker[];
	tags: QuestionTagInfo[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions/:questionId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	async handler(req): Promise<QuestionDetail> {
		const { guildId, amaId, questionId } = req.params;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const [question] = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions WHERE id = ${questionId} AND ama_id = ${amaId}
		`;

		if (!question) {
			throw notFound('question not found');
		}

		const [askerRows, tagRows] = await Promise.all([
			db<AmaQuestionAskers[]>`
				SELECT * FROM ama_question_askers WHERE question_id = ${questionId} ORDER BY merged_at ASC
			`,
			db<QuestionTagInfo[]>`
				SELECT t.id, t.name FROM ama_question_tags t
				INNER JOIN ama_question_tag_assignments ta ON ta.tag_id = t.id
				WHERE ta.question_id = ${questionId}
				ORDER BY t.name ASC
			`,
		]);

		const [author, answeredBy, extraAskers] = await Promise.all([
			resolveAmaUser(guildId, question.authorId),
			// Cache-first like every other `resolveAmaUser` call here, and in practice almost always a hit --
			// the answerer is typically the dashboard user who just acted, or a guest already resolved for the
			// AMA detail view.
			question.answeredById ? resolveAmaUser(guildId, question.answeredById) : null,
			Promise.all(
				askerRows.map(async (row): Promise<ExtraAsker> => ({
					author: await resolveAmaUser(guildId, row.authorId),
					content: row.content,
					mergedAt: row.mergedAt,
				})),
			),
		]);

		return { ...question, answeredBy, author, extraAskers, tags: tagRows };
	},
});
