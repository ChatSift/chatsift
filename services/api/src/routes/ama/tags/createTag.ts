import { getContext } from '@chatsift/backend-core';
import { amaQuestionsChannel } from '@chatsift/core';
import type { AmaQuestionTags, AmaSessions, AmaSessionsId } from '@chatsift/db';
import { conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { isUniqueViolation } from '../../../util/postgres.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const bodySchema = z.strictObject({
	name: z.string().trim().min(1).max(50),
});
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type CreateTagBody = z.input<typeof bodySchema>;
export type CreateTagResult = AmaQuestionTags;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/tags',
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
	async handler(req): Promise<CreateTagResult> {
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		try {
			const [tag] = await db<AmaQuestionTags[]>`
				INSERT INTO ama_question_tags (ama_id, name) VALUES (${amaId}, ${req.body.name}) RETURNING *
			`;

			return tag!;
		} catch (error) {
			if (isUniqueViolation(error, 'ama_question_tags_ama_id_name_key')) {
				throw conflict('a tag with this name already exists for this AMA', { conflictField: 'name' });
			}

			throw error;
		}
	},
});
