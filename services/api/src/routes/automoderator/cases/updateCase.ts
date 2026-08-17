import { getContext } from '@chatsift/backend-core';
import { automoderatorCasesChannel, formatCaseUserTag } from '@chatsift/core';
import type { AutomoderatorCases } from '@chatsift/db';
import { badRequest, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAutomoderator } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveDiscordUser } from '../../../util/users.js';
import { updateCaseBodySchema } from '../schemas.js';
import { refreshCaseLog } from './caseLog.js';
import type { CaseWithUsers } from './util.js';
import { resolveCaseUsers } from './util.js';

const bodySchema = updateCaseBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	caseId: z.coerce.number().int().positive(),
});

export type UpdateCaseBody = z.infer<typeof bodySchema>;
export type UpdateCaseResult = CaseWithUsers;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/automoderator/cases/:caseId',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorCasesChannel(req.params.guildId),
	async handler(req): Promise<UpdateCaseResult> {
		const { caseId, guildId } = req.params;
		const data = req.body;
		const db = getContext().db;

		const [existing] = await db<AutomoderatorCases[]>`
			SELECT * FROM automoderator_cases WHERE guild_id = ${guildId} AND case_id = ${caseId}
		`;

		if (!existing) {
			throw notFound('case not found');
		}

		if (data.refId !== undefined && data.refId !== null) {
			if (data.refId === caseId) {
				throw badRequest('a case cannot reference itself');
			}

			const [reference] = await db<{ caseId: number }[]>`
				SELECT case_id FROM automoderator_cases WHERE guild_id = ${guildId} AND case_id = ${data.refId}
			`;

			if (!reference) {
				throw badRequest('the referenced case does not exist');
			}
		}

		if (data.pardoned !== undefined && existing.actionType !== ('WARN' as AutomoderatorCases['actionType'])) {
			// Same rule the bot's `/case pardon` enforces: pardoning is what stops a warn counting toward P2's
			// ladder, and it means nothing for an action that was never counted.
			throw badRequest('only warns can be pardoned');
		}

		const columns: Partial<Pick<AutomoderatorCases, 'modId' | 'modTag' | 'pardonedBy' | 'reason' | 'refId'>> = {};

		if ('reason' in data) columns.reason = data.reason ?? null;
		if ('refId' in data) columns.refId = data.refId ?? null;

		// Taken from the session, never the body -- a client must not be able to attribute a pardon, or an
		// amendment, to someone else.
		const actorId = req.tokens!.access.sub;

		if (data.pardoned !== undefined) {
			columns.pardonedBy = data.pardoned ? actorId : null;
		}

		// Backfills attribution on a case nobody was credited for (an observed manual action whose moderator
		// couldn't be resolved, or -- from P5 -- a filter hit the bot authored).
		//
		// Gated to the edits that actually re-author the case, mirroring the bot: `/case pardon` writes only
		// `pardonedBy` and never touches `mod`. Who pardoned a case is a different fact from who issued it, and
		// `pardoned_by` already records the first one -- crediting the pardoner as the acting moderator would
		// overwrite "the filter did this" with "whoever forgave it did this".
		const reauthors = 'reason' in data || 'refId' in data;

		if (reauthors && !existing.modId) {
			const actor = await resolveDiscordUser(discordAPIAutomoderator, actorId);
			columns.modId = actorId;
			// The shared tag format, not a bare `.username`: that drops the discriminator on a legacy account and
			// the mod-log footer then disagrees with every case the bot filed.
			columns.modTag = typeof actor === 'string' ? actorId : formatCaseUserTag(actor);
		}

		const [updated] = await db<AutomoderatorCases[]>`
			UPDATE automoderator_cases SET ${db(columns)}
			WHERE id = ${existing.id}
			RETURNING *
		`;

		// Deleted between the read above and this write. Reporting it as a 404 is both true and what the client
		// already handles; the alternative is a 500 out of the non-null assertions below.
		if (!updated) {
			throw notFound('case not found');
		}

		await refreshCaseLog(updated);

		const [resolved] = await resolveCaseUsers([updated]);
		return resolved!;
	},
});
