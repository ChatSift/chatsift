import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

// RFC 4180 field escaping. `author_id`/`state`/timestamps are always safe (snowflakes, a fixed enum, ISO strings)
// -- only free-text `content` can contain a comma, quote, or newline that would otherwise break column boundaries.
function csvField(value: string): string {
	// CSV/formula injection guard (CWE-1236): `content` is arbitrary user-authored text, and Excel/Sheets treats a
	// cell starting with =, +, -, or @ as a formula on open. Prefixing with a single quote forces it to be read as
	// text instead of letting a submitted question execute as a formula in a mod's spreadsheet.
	const neutralized = /^[+=@-]/.test(value) ? `'${value}` : value;

	if (/[\n",]/.test(neutralized)) {
		return `"${neutralized.replaceAll('"', '""')}"`;
	}

	return neutralized;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/export',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req, res): Promise<void> {
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		type ExportQuestionRow = Pick<
			AmaQuestions,
			'answerContent' | 'answeredById' | 'authorId' | 'content' | 'createdAt' | 'id' | 'state' | 'updatedAt'
		>;

		const [questions, tagsByQuestion, askersByQuestion] = await Promise.all([
			db<ExportQuestionRow[]>`
				SELECT id, author_id, state, content, answer_content, answered_by_id, created_at, updated_at
				FROM ama_questions
				WHERE ama_id = ${amaId}
				ORDER BY created_at ASC
			`,
			// Grouped ;-joined per question rather than a per-row LEFT JOIN, which would multiply rows for a
			// question with more than one tag/asker and break the 1-row-per-question CSV shape.
			db<{ names: string; questionId: number }[]>`
				SELECT ta.question_id, string_agg(t.name, ';' ORDER BY t.name) AS names
				FROM ama_question_tag_assignments ta
				INNER JOIN ama_question_tags t ON t.id = ta.tag_id
				WHERE t.ama_id = ${amaId}
				GROUP BY ta.question_id
			`,
			db<{ authorIds: string; questionId: number }[]>`
				SELECT question_id, string_agg(author_id, ';' ORDER BY merged_at) AS author_ids
				FROM ama_question_askers
				WHERE question_id IN (SELECT id FROM ama_questions WHERE ama_id = ${amaId})
				GROUP BY question_id
			`,
		]);

		const tagsByQuestionId = new Map(tagsByQuestion.map((row) => [row.questionId, row.names]));
		const askersByQuestionId = new Map(askersByQuestion.map((row) => [row.questionId, row.authorIds]));

		const rows = [
			'author_id,state,content,created_at,updated_at,answer_content,answered_by_id,tags,askers',
			...questions.map((question) =>
				[
					question.authorId,
					question.state,
					csvField(question.content),
					question.createdAt.toISOString(),
					question.updatedAt.toISOString(),
					question.answerContent ? csvField(question.answerContent) : '',
					question.answeredById ?? '',
					tagsByQuestionId.get(question.id) ?? '',
					askersByQuestionId.get(question.id) ?? '',
				].join(','),
			),
		];

		res.statusCode = 200;
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="ama-${amaId}-questions.csv"`);
		res.end(rows.join('\r\n'));
	},
});
