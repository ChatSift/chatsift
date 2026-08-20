import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorBypassRoles } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * Just the id: the role's name and colour come from the guild's role list, which the dashboard already loads
 * for every `RoleSelect`. Storing a name snapshot alongside would go stale the first time somebody renames a
 * role, and this list is short enough that resolving it client-side costs nothing.
 */
export interface BypassRole {
	readonly roleId: string;
}

export type ListBypassRolesResult = BypassRole[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/bypass-roles',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListBypassRolesResult> {
		const rows = await getContext().db<Pick<AutomoderatorBypassRoles, 'roleId'>[]>`
			SELECT role_id FROM automoderator_bypass_roles WHERE guild_id = ${req.params.guildId} ORDER BY role_id ASC
		`;

		// `.toString()` because kanel brands primary-key columns.
		return rows.map((row) => ({ roleId: row.roleId.toString() }));
	},
});
