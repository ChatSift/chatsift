import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReportPrompts } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	promptId: z.coerce.number().int().positive(),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/report-prompts/:promptId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req, res): Promise<void> {
		const { guildId, promptId } = req.params;

		const [deleted] = await getContext().db<AutomoderatorReportPrompts[]>`
			DELETE FROM automoderator_report_prompts WHERE id = ${promptId} AND guild_id = ${guildId}
			RETURNING *
		`;

		if (!deleted) {
			throw notFound('report prompt not found');
		}

		void (async () => {
			try {
				await apiForGuild('AUTOMODERATOR', guildId).channels.deleteMessage(deleted.channelId, deleted.messageId);
			} catch (error) {
				req.logger.warn({ err: error }, 'failed to delete a report prompt message on Discord');
			}
		})();

		res.statusCode = 200;
		res.end();
	},
});
