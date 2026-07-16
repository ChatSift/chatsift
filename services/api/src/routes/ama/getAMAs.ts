import { getContext } from '@chatsift/backend-core';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import type { AMASessionRow } from '../../util/amaTypes.js';
import { snowflakeSchema } from '../../util/schemas.js';

const querySchema = z.strictObject({
	include_ended: z.stringbool().optional().default(false),
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetAMAsQuery = z.input<typeof querySchema>;

export interface AMASessionWithCount extends AMASessionRow {
	questionCount: number;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas',
	schema: {
		query: querySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<AMASessionWithCount[]> {
		const { include_ended } = req.query;
		const { guildId } = req.params;

		const sessions = include_ended
			? await getContext().rawDb<AMASessionRow[]>`
					SELECT * FROM ama_sessions WHERE guild_id = ${guildId} ORDER BY id DESC
				`
			: await getContext().rawDb<AMASessionRow[]>`
					SELECT * FROM ama_sessions WHERE guild_id = ${guildId} AND ended = false ORDER BY id DESC
				`;

		const sessionIds = sessions.map((session) => session.id);
		const questionCounts = sessionIds.length
			? await getContext().rawDb<{ amaId: number; count: string }[]>`
					SELECT ama_id, COUNT(*) AS count
					FROM ama_questions
					WHERE ama_id IN ${getContext().rawDb(sessionIds)}
					GROUP BY ama_id
				`
			: [];

		const countsBySession = new Map<number, number>();
		for (const { amaId, count } of questionCounts) {
			countsBySession.set(amaId, Number(count));
		}

		return sessions.map((session) => ({
			...session,
			questionCount: countsBySession.get(session.id) ?? 0,
		}));
	},
});
