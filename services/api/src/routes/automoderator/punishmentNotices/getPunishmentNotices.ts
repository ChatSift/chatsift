import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorPunishmentNotices } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { readAppealLink } from '../../../util/appealLink.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { PunishmentNoticeScope } from '../schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface PunishmentNotice {
	readonly content: string;
	readonly scope: PunishmentNoticeScope;
}

export interface GetPunishmentNoticesResult {
	/**
	 * `unban.app/g/<guildId>`, or `null` for a guild that does not accept appeals (#232 P3b).
	 *
	 * Answered here rather than left to the dashboard because it is two questions the dashboard cannot ask on
	 * its own: it has no `appeals_settings` read of its own on this screen, and it has no `unban.app` origin --
	 * that lives in the API's `APPEALS_FRONTEND_URL`, and a `NEXT_PUBLIC_` copy of it would be a second place
	 * to get the domain wrong. Null is what the editor upsells against; non-null is what it offers to paste.
	 */
	readonly appealLink: string | null;
	readonly notices: PunishmentNotice[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/punishment-notices',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<GetPunishmentNoticesResult> {
		const { guildId } = req.params;

		const [rows, appealLink] = await Promise.all([
			getContext().db<Pick<AutomoderatorPunishmentNotices, 'content' | 'scope'>[]>`
				SELECT scope, content FROM automoderator_punishment_notices
				WHERE guild_id = ${guildId}
			`,
			readAppealLink(guildId),
		]);

		return {
			// The cast is kanel's primary-key branding coming off, the same one `listFilterExemptions` does.
			notices: rows.map((row) => ({ scope: row.scope as unknown as PunishmentNoticeScope, content: row.content })),
			appealLink,
		};
	},
});
