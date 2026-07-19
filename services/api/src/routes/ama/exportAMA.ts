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
	if (/[\n",]/.test(value)) {
		return `"${value.replaceAll('"', '""')}"`;
	}

	return value;
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

		const questions = await db<Pick<AmaQuestions, 'authorId' | 'content' | 'createdAt' | 'state' | 'updatedAt'>[]>`
			SELECT author_id, state, content, created_at, updated_at
			FROM ama_questions
			WHERE ama_id = ${amaId}
			ORDER BY created_at ASC
		`;

		const rows = [
			'author_id,state,content,created_at,updated_at',
			...questions.map((question) =>
				[
					question.authorId,
					question.state,
					csvField(question.content),
					question.createdAt.toISOString(),
					question.updatedAt.toISOString(),
				].join(','),
			),
		];

		res.statusCode = 200;
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="ama-${amaId}-questions.csv"`);
		res.end(rows.join('\r\n'));
	},
});
