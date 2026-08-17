import { getContext } from '@chatsift/backend-core';
import { automoderatorReportPresetsChannel } from '@chatsift/core';
import type { AutomoderatorReportPresets, AutomoderatorReportPresetsId } from '@chatsift/db';
import { isUniqueViolation } from '@chatsift/db';
import { conflict, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { reportPresetBodySchema } from '../schemas.js';

const bodySchema = reportPresetBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	presetId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AutomoderatorReportPresetsId),
});

export type UpdateReportPresetBody = z.input<typeof bodySchema>;
export type UpdateReportPresetResult = AutomoderatorReportPresets;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/automoderator/report-presets/:presetId',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorReportPresetsChannel(req.params.guildId),
	async handler(req): Promise<UpdateReportPresetResult> {
		const { guildId, presetId } = req.params;
		const db = getContext().db;

		try {
			// `guild_id` in the WHERE is what stops a manager of one guild renaming another's preset -- the id is
			// a global sequence.
			//
			// Editing a preset does **not** rewrite anything already reported: the chosen text is copied into
			// `automoderator_reporters.reason` at report time, so this only changes what future reporters see.
			const [preset] = await db<AutomoderatorReportPresets[]>`
				UPDATE automoderator_report_presets SET reason = ${req.body.reason}
				WHERE id = ${presetId} AND guild_id = ${guildId}
				RETURNING *
			`;

			if (!preset) {
				throw notFound('report preset not found');
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
