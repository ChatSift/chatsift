import { getContext } from '@chatsift/backend-core';
import { automoderatorReportPresetsChannel } from '@chatsift/core';
import type { AutomoderatorReportPresets, AutomoderatorReportPresetsId } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	presetId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as AutomoderatorReportPresetsId),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/report-presets/:presetId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorReportPresetsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, presetId } = req.params;

		// Existing reports keep the reason text they were filed with -- nothing references a preset row, so
		// there is nothing to cascade.
		const [deleted] = await getContext().db<Pick<AutomoderatorReportPresets, 'id'>[]>`
			DELETE FROM automoderator_report_presets WHERE id = ${presetId} AND guild_id = ${guildId}
			RETURNING id
		`;

		if (!deleted) {
			throw notFound('report preset not found');
		}

		res.statusCode = 200;
		res.end();
	},
});
