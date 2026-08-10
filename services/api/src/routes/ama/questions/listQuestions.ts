import { getContext } from '@chatsift/backend-core';
import type { AmaQuestions, AmaQuestionState, AmaSessions, AmaSessionsId } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { badRequest, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { createPaginationQuerySchema, snowflakeSchema } from '../../../util/schemas.js';
import { QUESTION_STATES } from '../constants.js';
import { resolveAmaUser } from './util.js';

const querySchema = z
	.strictObject({
		// CSV of ama_question_state values -- lets the dashboard's "Pending" tab pass every pending-ish
		// state at once. Validated against QUESTION_STATES below rather than in the schema itself, since
		// zod's enum().array() doesn't compose cleanly with a comma-split string param.
		states: z.string().optional(),
		tag_id: z.coerce.number().int().positive().optional(),
		author_id: snowflakeSchema.optional(),
		q: z.string().trim().min(1).max(200).optional(),
	})
	.extend(createPaginationQuerySchema(25, 100).shape);
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type ListQuestionsQuery = z.input<typeof querySchema>;

export interface QuestionTagInfo {
	id: number;
	name: string;
}

export interface QuestionListItem extends AmaQuestions {
	author: APIUser | Snowflake;
	extraAskerCount: number;
	tags: QuestionTagInfo[];
}

export interface ListQuestionsResult {
	nextCursor: number | null;
	questions: QuestionListItem[];
}

interface QuestionListRow extends AmaQuestions {
	extraAskerCount: string;
	tags: QuestionTagInfo[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/questions',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	async handler(req): Promise<ListQuestionsResult> {
		const { guildId, amaId } = req.params;
		const { author_id: authorId, cursor, limit, q, states: statesRaw, tag_id: tagId } = req.query;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		let states: AmaQuestionState[] | undefined;
		if (statesRaw) {
			const parsed = statesRaw.split(',') as AmaQuestionState[];
			const invalid = parsed.filter((state) => !QUESTION_STATES.includes(state));
			if (invalid.length > 0) {
				throw badRequest(`invalid state(s): ${invalid.join(', ')}`);
			}

			states = parsed;
		}

		// Fetches one extra row over `limit` purely to know whether a next page exists, same idiom as
		// modmail's listThreads.ts.
		//
		// The asker join excludes the question's own author so this `(+N)` badge counts the same people the
		// Discord embed's "Also asked by" line does (see `countExtraAskers` in `util.ts`) -- merging two of
		// your own questions records you as an asker on your own question, which shouldn't read as somebody
		// else having asked it too.
		const rows = await db<QuestionListRow[]>`
			SELECT
				q.*,
				COUNT(DISTINCT a.id) AS extra_asker_count,
				COALESCE(
					jsonb_agg(DISTINCT jsonb_build_object('id', t.id, 'name', t.name)) FILTER (WHERE t.id IS NOT NULL),
					'[]'
				) AS tags
			FROM ama_questions q
			LEFT JOIN ama_question_askers a ON a.question_id = q.id AND a.author_id <> q.author_id
			LEFT JOIN ama_question_tag_assignments ta ON ta.question_id = q.id
			LEFT JOIN ama_question_tags t ON t.id = ta.tag_id
			WHERE q.ama_id = ${amaId}
				${states?.length ? db`AND q.state = ANY(${states})` : db``}
				${authorId ? db`AND q.author_id = ${authorId}` : db``}
				${q ? db`AND q.content ILIKE ${`%${q}%`}` : db``}
				${
					tagId
						? db`AND EXISTS (
							SELECT 1 FROM ama_question_tag_assignments ta2 WHERE ta2.question_id = q.id AND ta2.tag_id = ${tagId}
						)`
						: db``
				}
				${cursor ? db`AND q.id < ${cursor}` : db``}
			GROUP BY q.id
			ORDER BY q.id DESC
			LIMIT ${limit + 1}
		`;

		const hasNextPage = rows.length > limit;
		const page = hasNextPage ? rows.slice(0, limit) : rows;

		// Dedup'd the same way listThreads.ts resolves ticket-opener users -- several questions on a page
		// can easily share an author.
		const authorIds = new Set(page.map((row) => row.authorId));
		const authorEntries = await Promise.all(
			[...authorIds].map(async (authorId_): Promise<[string, APIUser | Snowflake]> => [
				authorId_,
				await resolveAmaUser(guildId, authorId_),
			]),
		);
		const authorsById = new Map(authorEntries);

		const questions = page.map((row): QuestionListItem => {
			const { extraAskerCount, tags, ...question } = row;
			return {
				...question,
				author: authorsById.get(question.authorId)!,
				extraAskerCount: Number(extraAskerCount),
				tags,
			};
		});

		return { nextCursor: hasNextPage ? page.at(-1)!.id : null, questions };
	},
});
