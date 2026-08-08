import { getContext } from '@chatsift/backend-core';
import type { AmaSessions, AmaSessionsId } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed, isGuildManagerToken } from '../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../util/schemas.js';

const querySchema = z.strictObject({
	include_ended: z.stringbool().optional().default(false),
});
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type GetAMAsQuery = z.input<typeof querySchema>;

export interface AMASessionWithCount extends AmaSessions {
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
		// Not a hard `isGuildManager` gate -- guests need to reach this too (it backs breadcrumbs/nav on
		// every AMA subpage, including the ones guests can reach), just filtered to a narrower result set
		// in the handler below rather than rejected outright.
		isGuildManager: false,
	}),
	async handler(req, res): Promise<AMASessionWithCount[]> {
		const { include_ended } = req.query;
		const { guildId } = req.params;
		const isManager = await isGuildManagerToken(req, res);

		const db = getContext().db;
		const sessions = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions
			WHERE guild_id = ${guildId}
			${include_ended ? db`` : db`AND ended = false`}
			${isManager ? db`` : db`AND ${req.tokens.access.sub} = ANY(guest_ids)`}
			ORDER BY id DESC
		`;

		const sessionIds = sessions.map((session) => session.id);
		const questionCounts = sessionIds.length
			? await db<{ amaId: AmaSessionsId; count: string }[]>`
					SELECT ama_id, COUNT(*) AS count
					FROM ama_questions
					WHERE ama_id IN ${db(sessionIds)}
					GROUP BY ama_id
				`
			: [];

		const countsBySession = new Map<AmaSessionsId, number>();
		for (const { amaId, count } of questionCounts) {
			countsBySession.set(amaId, Number(count));
		}

		return sessions.map((session) => ({
			...session,
			questionCount: countsBySession.get(session.id) ?? 0,
		}));
	},
});
