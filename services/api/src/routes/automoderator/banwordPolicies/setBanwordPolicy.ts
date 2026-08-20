import { getContext } from '@chatsift/backend-core';
import { automoderatorBanwordPoliciesChannel, BANWORD_POLICY_MAX_COUNT } from '@chatsift/core';
import type { AutomoderatorBanwordPolicies } from '@chatsift/db';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { setBanwordPolicyBodySchema } from '../schemas.js';

const bodySchema = setBanwordPolicyBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type SetBanwordPolicyBody = z.input<typeof bodySchema>;
export type SetBanwordPolicyResult = AutomoderatorBanwordPolicies;

/**
 * Creates or replaces the policy for one `(rule, keyword)` pair.
 *
 * A PUT with the key in the *body* rather than the path, unlike the warn ladder's rung route: the key here is a
 * pair whose second half is nullable, and there is no honest way to spell "no keyword" as a path segment --
 * an empty segment is unroutable and a sentinel like `_` is a value a real keyword could take.
 *
 * The rule id is deliberately not validated against Discord. A rule can be deleted between the editor loading
 * and the save landing, and a policy for a rule that no longer exists is inert rather than harmful -- the list
 * route renders it as an orphan. Round-tripping to Discord on every save to reject that case would trade a
 * visible orphan for a failed save, which is the worse of the two.
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/banword-policies',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorBanwordPoliciesChannel(req.params.guildId),
	async handler(req): Promise<SetBanwordPolicyResult> {
		const { guildId } = req.params;
		const { ruleId, keyword, actionType } = req.body;
		const durationSeconds = req.body.durationSeconds ?? null;

		// The cap is checked inside the write, the same shape `logExemptions/setLogExemption.ts` uses, and with
		// the same accepted looseness: under READ COMMITTED two concurrent inserts both see the pre-insert count,
		// so a burst can land a guild a few rows over. That is fine -- this cap bounds how much the bot reads per
		// AutoMod event, it does not hold an invariant.
		//
		// `IS NOT DISTINCT FROM` rather than `=` for the keyword, because null is a real value here and `=` is
		// never true against it -- without this, editing an existing rule-level policy at the cap would be
		// rejected as if it were a new one.
		const [row] = await getContext().db<AutomoderatorBanwordPolicies[]>`
			INSERT INTO automoderator_banword_policies (guild_id, rule_id, keyword, action_type, duration_seconds)
			SELECT ${guildId}, ${ruleId}, ${keyword}, ${actionType}, ${durationSeconds}
			WHERE (SELECT count(*) FROM automoderator_banword_policies WHERE guild_id = ${guildId})
					< ${BANWORD_POLICY_MAX_COUNT}
				OR EXISTS (
					SELECT 1 FROM automoderator_banword_policies
					WHERE guild_id = ${guildId} AND rule_id = ${ruleId} AND keyword IS NOT DISTINCT FROM ${keyword}
				)
			ON CONFLICT (guild_id, rule_id, keyword) DO UPDATE
				SET action_type = EXCLUDED.action_type, duration_seconds = EXCLUDED.duration_seconds
			RETURNING *
		`;

		// No row means the `WHERE` above rejected it, which can only be the cap.
		if (!row) {
			throw badRequest(`a server can have at most ${BANWORD_POLICY_MAX_COUNT} banned word policies`);
		}

		return row;
	},
});
