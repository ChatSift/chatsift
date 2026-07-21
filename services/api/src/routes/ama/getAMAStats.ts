import { getContext } from '@chatsift/backend-core';
import type { AmaQuestionState, AmaSessions, AmaSessionsId } from '@chatsift/db';
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

// Kept as a literal tuple rather than derived from the `ama_question_state` enum at runtime: `AmaQuestionState` is
// `export type`-only (kanel generates it as a real enum, but `@chatsift/db` only re-exports its type), so there's
// no runtime value to iterate here. Mirrors `CREATE TYPE ama_question_state` in packages/db/schema/schema.sql.
// The cast is required because TS string enums are nominal -- a plain string literal isn't structurally
// assignable to one, even though the runtime values are identical.
const QUESTION_STATES = [
	'PENDING_MOD_REVIEW',
	'PENDING_GUEST_REVIEW',
	'FLAGGED',
	'APPROVED',
	'DENIED',
] as readonly AmaQuestionState[];

export interface AMAStats {
	byState: Record<AmaQuestionState, number>;
	total: number;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/ama/amas/:amaId/stats',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<AMAStats> {
		const { guildId, amaId } = req.params;
		const db = getContext().db;

		const [session] = await db<Pick<AmaSessions, 'id'>[]>`
			SELECT id FROM ama_sessions WHERE guild_id = ${guildId} AND id = ${amaId}
		`;

		if (!session) {
			throw notFound('ama session not found');
		}

		const counts = await db<{ count: string; state: AmaQuestionState }[]>`
			SELECT state, COUNT(*) AS count FROM ama_questions WHERE ama_id = ${amaId} GROUP BY state
		`;

		const byState = Object.fromEntries(QUESTION_STATES.map((state) => [state, 0])) as Record<AmaQuestionState, number>;

		let total = 0;
		for (const { state, count } of counts) {
			const parsed = Number(count);
			byState[state] = parsed;
			total += parsed;
		}

		return { byState, total };
	},
});
