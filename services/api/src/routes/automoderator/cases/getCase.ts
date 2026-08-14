import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCases } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { CaseWithUsers } from './util.js';
import { resolveCaseUsers } from './util.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	caseId: z.coerce.number().int().positive(),
});

export interface GetCaseResult {
	case: CaseWithUsers;
	reference: CaseWithUsers | null;
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/cases/:caseId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<GetCaseResult> {
		const { caseId, guildId } = req.params;
		const db = getContext().db;

		const [row] = await db<AutomoderatorCases[]>`
			SELECT * FROM automoderator_cases WHERE guild_id = ${guildId} AND case_id = ${caseId}
		`;

		if (!row) {
			throw notFound('case not found');
		}

		const [reference] =
			row.refId === null
				? []
				: await db<AutomoderatorCases[]>`
						SELECT * FROM automoderator_cases WHERE guild_id = ${guildId} AND case_id = ${row.refId}
					`;

		const [resolved, resolvedReference] = await resolveCaseUsers(reference ? [row, reference] : [row]);
		return { case: resolved!, reference: resolvedReference ?? null };
	},
});
