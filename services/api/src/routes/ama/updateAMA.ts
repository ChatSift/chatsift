import { getContext } from '@chatsift/backend-core';
import type { AmaSessions, AmaSessionsId } from '@chatsift/db';
import { badData, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';
import { updateAMABodySchema } from './schemas.js';

const bodySchema = updateAMABodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	amaId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AmaSessionsId),
});

export type UpdateAMABody = z.input<typeof bodySchema>;
export type UpdateAMAResult = AmaSessions;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/ama/amas/:amaId',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<UpdateAMAResult> {
		const data = req.body;
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [existingAMA] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!existingAMA) {
			throw notFound('AMA session not found');
		}

		if (existingAMA.ended) {
			throw badData('AMA session is already ended');
		}

		if ('ended' in data) {
			const [updated] = await db<AmaSessions[]>`
				UPDATE ama_sessions
				SET ended = ${data.ended}
				WHERE id = ${amaId} AND guild_id = ${guildId}
				RETURNING *
			`;

			return updated!;
		}

		const columns = Object.keys(data) as (keyof typeof data)[];
		const [updated] = await db<AmaSessions[]>`
			UPDATE ama_sessions
			SET ${db(data, ...columns)}
			WHERE id = ${amaId} AND guild_id = ${guildId}
			RETURNING *
		`;

		return updated!;
	},
});
