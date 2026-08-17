import { getContext, resolveHistoryToken } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { discordAPIAutomoderator } from '../../util/discordAPI.js';

const paramsSchema = z.object({ token: z.uuid() });

/**
 * One case as its *subject* sees it.
 *
 * Deliberately narrower than the moderator-facing shape: no moderator identity, no internal row id, no
 * `idempotency_key`, no `log_message_id`. Who actioned someone is staff information — the mod log records it
 * for the people who can read the mod log — and this page is shown to the person the case is about, who has no
 * access to that guild's dashboard at all.
 *
 * Pardoned cases are excluded upstream, matching `/history`: a warn that was taken back should not follow
 * someone around.
 */
export interface PublicHistoryCase {
	action: AutomoderatorCaseAction;
	caseId: number;
	createdAt: Date;
	expiresAt: Date | null;
	reason: string | null;
}

export interface PublicHistoryResult {
	cases: PublicHistoryCase[];
	guildName: string | null;
}

export default defineRoute({
	method: 'get',
	path: '/v3/automoderator/history/:token',
	schema: { params: paramsSchema },
	async handler(req): Promise<PublicHistoryResult> {
		const { token } = req.params;

		const target = await resolveHistoryToken(token);
		if (!target) {
			throw notFound('this link has expired');
		}

		const cases = await getContext().db<AutomoderatorCases[]>`
			SELECT case_id, action_type, reason, expires_at, created_at
			FROM automoderator_cases
			WHERE guild_id = ${target.guildId}
				AND target_id = ${target.userId}
				AND pardoned_by IS NULL
			ORDER BY id DESC
			LIMIT 100
		`;

		let guildName: string | null = null;
		try {
			guildName = (await discordAPIAutomoderator.guilds.get(target.guildId)).name;
		} catch {
			// A name is decoration; the history is the payload. Losing it to a transient Discord failure must not
			// cost someone their own record.
			guildName = null;
		}

		return {
			guildName,
			cases: cases.map((row) => ({
				caseId: row.caseId,
				action: row.actionType,
				reason: row.reason,
				expiresAt: row.expiresAt,
				createdAt: row.createdAt,
			})),
		};
	},
});
