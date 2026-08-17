import { getContext } from '@chatsift/backend-core';
import {
	automoderatorWarnPunishmentsChannel,
	WARN_PUNISHMENT_MAX_COUNT,
	WARN_PUNISHMENT_MAX_WARNS,
} from '@chatsift/core';
import type { AutomoderatorWarnPunishments } from '@chatsift/db';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { warnPunishmentBodySchema } from '../schemas.js';

const bodySchema = warnPunishmentBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	warns: z.coerce.number().int().min(1).max(WARN_PUNISHMENT_MAX_WARNS),
});

export type SetWarnPunishmentBody = z.input<typeof bodySchema>;
export type SetWarnPunishmentResult = AutomoderatorWarnPunishments;

export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/warn-punishments/:warns',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorWarnPunishmentsChannel(req.params.guildId),
	async handler(req): Promise<SetWarnPunishmentResult> {
		const { guildId, warns } = req.params;
		const durationSeconds = req.body.durationSeconds ?? null;
		// A move onto the count it already sits at is just an edit; dropping it here keeps the delete below from
		// removing the row this is about to write.
		const replaces = req.body.replaces === warns ? undefined : req.body.replaces;

		// One transaction so a renumber is atomic: the old row goes and the new one arrives together, or neither
		// does. It also has to be a transaction for the cap to be right -- the delete has to be visible to the
		// count below, or a guild on a full ladder could never renumber a step (the insert would see a full
		// ladder while the old row was still there).
		return getContext().db.begin(async (db) => {
			if (replaces !== undefined) {
				await db`
					DELETE FROM automoderator_warn_punishments WHERE guild_id = ${guildId} AND warns = ${replaces}
				`;
			}

			// The cap is checked inside the write, like `createPreset.ts`'s, rather than by a count query in front
			// of it. `EXISTS` is what keeps *editing* an existing step legal at the cap -- a guild sitting on the
			// maximum must still be able to change one.
			const [row] = await db<AutomoderatorWarnPunishments[]>`
				INSERT INTO automoderator_warn_punishments (guild_id, warns, action_type, duration_seconds)
				SELECT ${guildId}, ${warns}, ${req.body.actionType}, ${durationSeconds}
				WHERE (SELECT count(*) FROM automoderator_warn_punishments WHERE guild_id = ${guildId})
						< ${WARN_PUNISHMENT_MAX_COUNT}
					OR EXISTS (
						SELECT 1 FROM automoderator_warn_punishments WHERE guild_id = ${guildId} AND warns = ${warns}
					)
				ON CONFLICT (guild_id, warns) DO UPDATE
					SET action_type = EXCLUDED.action_type, duration_seconds = EXCLUDED.duration_seconds
				RETURNING *
			`;

			// No row means the `WHERE` above rejected it, which can only be the cap. Thrown inside the
			// transaction so a renumber that can't land also doesn't lose the step it was moving.
			if (!row) {
				throw badRequest(`a warn ladder can have at most ${WARN_PUNISHMENT_MAX_COUNT} steps`);
			}

			return row;
		});
	},
});
