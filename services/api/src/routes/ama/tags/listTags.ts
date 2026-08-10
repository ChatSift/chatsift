import { getContext } from '@chatsift/backend-core';
import type { AmaQuestionTags, AmaSessions, AmaSessionsId } from '@chatsift/db';
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
});

/**
 * `count` is how many questions in this session currently carry the tag. It's here rather than only on
 * `getAMAStats.ts`'s `byTag` because the Triage page's tag picker needs it without pulling the whole
 * stats payload -- deleting a tag cascades its assignments away, so the confirm has to say how many
 * questions that's about to affect.
 */
export type ListTagsResult = (AmaQuestionTags & { count: number })[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/tags',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: 'or-ama-guest',
	}),
	async handler(req): Promise<ListTagsResult> {
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		// LEFT JOIN, so a tag nobody has used yet reports 0 instead of dropping out of the list entirely
		// (same aggregate `getAMAStats.ts` runs for `byTag`).
		const tags = await db<(AmaQuestionTags & { count: string })[]>`
			SELECT t.*, COUNT(ta.question_id) AS count
			FROM ama_question_tags t
			LEFT JOIN ama_question_tag_assignments ta ON ta.tag_id = t.id
			WHERE t.ama_id = ${amaId}
			GROUP BY t.id
			ORDER BY t.name ASC
		`;

		// postgres.js hands COUNT back as a string -- bigint doesn't round-trip through JSON safely, so it
		// never gets coerced for us.
		return tags.map((tag) => ({ ...tag, count: Number(tag.count) }));
	},
});
