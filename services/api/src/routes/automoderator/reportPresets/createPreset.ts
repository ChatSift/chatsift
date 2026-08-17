import { getContext } from '@chatsift/backend-core';
import { automoderatorReportPresetsChannel } from '@chatsift/core';
import type { AutomoderatorReportPresets } from '@chatsift/db';
import { isUniqueViolation } from '@chatsift/db';
import { badRequest, conflict } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { REPORT_PRESET_MAX_COUNT, reportPresetBodySchema } from '../schemas.js';

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

		const [existing] = await db<{ count: string }[]>`
			SELECT count(*) FROM automoderator_report_presets WHERE guild_id = ${guildId}
		`;

		if (Number(existing?.count ?? 0) >= REPORT_PRESET_MAX_COUNT) {
			throw badRequest(`a server can have at most ${REPORT_PRESET_MAX_COUNT} report reasons`);
		}

		try {
			const [preset] = await db<AutomoderatorReportPresets[]>`
				INSERT INTO automoderator_report_presets (guild_id, reason)
				VALUES (${guildId}, ${req.body.reason})
				RETURNING *
			`;

			return preset!;
		} catch (error) {
			if (isUniqueViolation(error, 'automoderator_report_presets_guild_id_reason_key')) {
				throw conflict('this server already has that report reason', { conflictField: 'reason' });
			}

			throw error;
		}
	},
});
