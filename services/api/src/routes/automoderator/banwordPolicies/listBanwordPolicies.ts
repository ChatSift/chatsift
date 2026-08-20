import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorBanwordPolicies } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export type ListBanwordPoliciesResult = AutomoderatorBanwordPolicies[];

/**
 * Every policy the guild has, rules and keywords together. Not scoped to one rule: the editor renders the
 * guild's whole rule list at once and needs to show which of them already carry policies, including the ones
 * whose rule has since been deleted on Discord's side.
 *
 * `keyword NULLS FIRST` so a rule-level policy sorts above the keyword-level ones that override it, which is
 * the order the editor reads them in.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/banword-policies',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListBanwordPoliciesResult> {
		return getContext().db<AutomoderatorBanwordPolicies[]>`
			SELECT * FROM automoderator_banword_policies
			WHERE guild_id = ${req.params.guildId}
			ORDER BY rule_id ASC, keyword ASC NULLS FIRST
		`;
	},
});
