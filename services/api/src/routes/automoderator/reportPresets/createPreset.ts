import { getContext } from '@chatsift/backend-core';
import { automoderatorReportPresetsChannel, REPORT_PRESET_MAX_COUNT } from '@chatsift/core';
import type { AutomoderatorReportPresets } from '@chatsift/db';
import { isUniqueViolation } from '@chatsift/db';
import { badRequest, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { reportPresetBodySchema } from '../schemas.js';

const bodySchema = reportPresetBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateReportPresetBody = z.input<typeof bodySchema>;
export type CreateReportPresetResult = AutomoderatorReportPresets;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/automoderator/report-presets',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorReportPresetsChannel(req.params.guildId),
	async handler(req): Promise<CreateReportPresetResult> {
		const { guildId } = req.params;
		const db = getContext().db;

		try {
			// The cap is enforced *inside* the insert rather than by a count query in front of it. Two concurrent
			// creates both pass a separate read-then-write check and a guild ends up with 26 reasons, one of which
			// the picker silently never offers (it reads `LIMIT 25`) -- which reads as "the dashboard saved it and
			// the bot ignored it". `INSERT ... SELECT ... WHERE` makes the check and the write one statement.
			const [preset] = await db<AutomoderatorReportPresets[]>`
				INSERT INTO automoderator_report_presets (guild_id, reason)
				SELECT ${guildId}, ${req.body.reason}
				WHERE (SELECT count(*) FROM automoderator_report_presets WHERE guild_id = ${guildId})
					< ${REPORT_PRESET_MAX_COUNT}
				RETURNING *
			`;

			// No row means the `WHERE` above rejected it, which can only be the cap.
			if (!preset) {
				throw badRequest(`a server can have at most ${REPORT_PRESET_MAX_COUNT} report reasons`);
			}

			return preset;
		} catch (error) {
			if (isUniqueViolation(error, 'automoderator_report_presets_guild_id_reason_key')) {
				throw conflict('this server already has that report reason', { conflictField: 'reason' });
			}

			throw error;
		}
	},
});
