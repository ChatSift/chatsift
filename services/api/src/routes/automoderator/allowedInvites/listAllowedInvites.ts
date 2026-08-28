import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorAllowedInvites } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * A server the invite filter lets through.
 *
 * `name` is the snapshot taken when the entry was added and is presented as such -- this bot is not in the
 * allowlisted server, so nothing can refresh it. See the table's comment in schema.sql for why this is the one
 * place a name is stored at all.
 */
export interface AllowedInvite {
	readonly allowedGuildId: string;
	readonly name: string;
}

export type ListAllowedInvitesResult = AllowedInvite[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/allowed-invites',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListAllowedInvitesResult> {
		const rows = await getContext().db<Pick<AutomoderatorAllowedInvites, 'allowedGuildId' | 'name'>[]>`
			SELECT allowed_guild_id, name FROM automoderator_allowed_invites
			WHERE guild_id = ${req.params.guildId}
			ORDER BY name ASC
		`;

		// `.toString()` because kanel brands primary-key columns.
		return rows.map((row) => ({ allowedGuildId: row.allowedGuildId.toString(), name: row.name }));
	},
});
