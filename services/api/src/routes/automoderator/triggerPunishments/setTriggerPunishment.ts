import { getContext } from '@chatsift/backend-core';
import {
	automoderatorTriggerPunishmentsChannel,
	TRIGGER_PUNISHMENT_MAX_COUNT,
	TRIGGER_PUNISHMENT_MAX_TRIGGERS,
} from '@chatsift/core';
import type { AutomoderatorTriggerPunishments } from '@chatsift/db';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { triggerPunishmentBodySchema } from '../schemas.js';

const bodySchema = triggerPunishmentBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	triggers: z.coerce.number().int().min(1).max(TRIGGER_PUNISHMENT_MAX_TRIGGERS),
});

export type SetTriggerPunishmentBody = z.input<typeof bodySchema>;
export type SetTriggerPunishmentResult = AutomoderatorTriggerPunishments;

/**
 * The trigger ladder's write (P5c, feature 11). Structurally identical to `setWarnPunishment.ts` -- the
 * advisory lock, the `EXISTS` escape from the cap, and the atomic renumber all exist here for the reasons that
 * file spells out at length, and are not repeated.
 *
 * Not factored into a shared helper with it: the two differ in table, column, cap constant and error wording,
 * which is most of the statement, and a generic version parameterised on all four would be harder to read than
 * either. If a third ladder ever appears, that is the evidence to revisit this on.
 */
export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/trigger-punishments/:triggers',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorTriggerPunishmentsChannel(req.params.guildId),
	async handler(req): Promise<SetTriggerPunishmentResult> {
		const { guildId, triggers } = req.params;
		const durationSeconds = req.body.durationSeconds ?? null;
		const replaces = req.body.replaces === triggers ? undefined : req.body.replaces;

		return getContext().db.begin(async (db) => {
			await db`SELECT pg_advisory_xact_lock(${guildId}::bigint)`;

			if (replaces !== undefined) {
				await db`
					DELETE FROM automoderator_trigger_punishments WHERE guild_id = ${guildId} AND triggers = ${replaces}
				`;
			}

			const [row] = await db<AutomoderatorTriggerPunishments[]>`
				INSERT INTO automoderator_trigger_punishments (guild_id, triggers, action_type, duration_seconds)
				SELECT ${guildId}, ${triggers}, ${req.body.actionType}, ${durationSeconds}
				WHERE (SELECT count(*) FROM automoderator_trigger_punishments WHERE guild_id = ${guildId})
						< ${TRIGGER_PUNISHMENT_MAX_COUNT}
					OR EXISTS (
						SELECT 1 FROM automoderator_trigger_punishments WHERE guild_id = ${guildId} AND triggers = ${triggers}
					)
				ON CONFLICT (guild_id, triggers) DO UPDATE
					SET action_type = EXCLUDED.action_type, duration_seconds = EXCLUDED.duration_seconds
				RETURNING *
			`;

			if (!row) {
				throw badRequest(`a trigger ladder can have at most ${TRIGGER_PUNISHMENT_MAX_COUNT} steps`);
			}

			return row;
		});
	},
});
