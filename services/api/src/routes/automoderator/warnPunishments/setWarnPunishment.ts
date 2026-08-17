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
		const db = getContext().db;

		const [punishment] = await db<AutomoderatorWarnPunishments[]>`
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

		if (!punishment) {
			throw badRequest(`a warn ladder can have at most ${WARN_PUNISHMENT_MAX_COUNT} steps`);
		}

		return punishment;
	},
});
