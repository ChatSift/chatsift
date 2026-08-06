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
	mergedAt: Date;
}

export interface QuestionDetail extends AmaQuestions {
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
		isGuildManager: true,
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

		const [author, extraAskers] = await Promise.all([
			resolveAmaUser(guildId, question.authorId),
			Promise.all(
				askerRows.map(async (row): Promise<ExtraAsker> => ({
					author: await resolveAmaUser(guildId, row.authorId),
					mergedAt: row.mergedAt,
				})),
			),
		]);

		return { ...question, author, extraAskers, tags: tagRows };
	},
});
