import { getContext } from '@chatsift/backend-core';
import { automoderatorBypassRolesChannel, BYPASS_ROLE_MAX_COUNT } from '@chatsift/core';
import type { AutomoderatorBypassRoles } from '@chatsift/db';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertRolesBelongToGuild } from '../../../util/roles.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { BypassRole } from './listBypassRoles.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	roleId: snowflakeSchema,
});

export type SetBypassRoleResult = BypassRole;

export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/bypass-roles/:roleId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorBypassRolesChannel(req.params.guildId),
	async handler(req): Promise<SetBypassRoleResult> {
		const { guildId, roleId } = req.params;
		const context = getContext();

		// Same reasoning as the log-exemption route's channel check: the bot's REST client spans every guild it
		// is in, so without this a manager could park another server's role id in their own bypass list, where it
		// would sit unresolvable and indistinguishable from a role that was deleted.
		await assertRolesBelongToGuild(guildId, [roleId], 'AUTOMODERATOR', context.logger);

		// Cap enforced inside the insert, with the same deliberate looseness as the log-exemption route -- see
		// its comment. `DO UPDATE` setting the key to the value it already holds exists purely so `RETURNING`
		// still yields a row when the role was already listed; without it, "already bypassing" and "over the
		// cap" would both come back empty and this could not tell them apart.
		const [row] = await context.db<Pick<AutomoderatorBypassRoles, 'roleId'>[]>`
			INSERT INTO automoderator_bypass_roles (guild_id, role_id)
			SELECT ${guildId}, ${roleId}
			WHERE (
				SELECT count(*) FROM automoderator_bypass_roles
				WHERE guild_id = ${guildId} AND role_id <> ${roleId}
			) < ${BYPASS_ROLE_MAX_COUNT}
			ON CONFLICT (guild_id, role_id) DO UPDATE SET role_id = EXCLUDED.role_id
			RETURNING role_id
		`;

		if (!row) {
			throw badRequest(`a server can have at most ${BYPASS_ROLE_MAX_COUNT} bypass roles`);
		}

		return { roleId };
	},
});
