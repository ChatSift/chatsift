import { getContext } from '@chatsift/backend-core';
import { badData, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { AMASessionRow } from '../../util/amaTypes.js';
import { snowflakeSchema } from '../../util/schemas.js';

const bodySchema = z.strictObject({
	ended: z.literal(true),
});
const paramsSchema = z.object({ guildId: snowflakeSchema, amaId: z.coerce.number().int().positive() });

export type UpdateAMABody = z.input<typeof bodySchema>;
export type UpdateAMAResult = AMASessionRow;

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

		const [existingAMA] = await getContext().rawDb<AMASessionRow[]>`
			SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!existingAMA) {
			throw notFound('AMA session not found');
		}

		if (existingAMA.ended) {
			throw badData('AMA session is already ended');
		}

		const [updated] = await getContext().rawDb<AMASessionRow[]>`
			UPDATE ama_sessions
			SET ended = ${data.ended}
			WHERE id = ${amaId} AND guild_id = ${guildId}
			RETURNING *
		`;

		return updated!;
	},
});
