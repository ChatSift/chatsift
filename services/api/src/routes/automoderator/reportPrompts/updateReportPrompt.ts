import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReportPrompts } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { updateReportPromptBodySchema } from '../schemas.js';
import { buildReportPromptBody } from './util.js';

const bodySchema = updateReportPromptBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	promptId: z.coerce.number().int().positive(),
});

export type UpdateReportPromptBody = z.input<typeof bodySchema>;
export type UpdateReportPromptResult = AutomoderatorReportPrompts;

export default defineRoute({
	method: 'patch',
	path: '/v3/guilds/:guildId/automoderator/report-prompts/:promptId',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<UpdateReportPromptResult> {
		const { guildId, promptId } = req.params;
		const db = getContext().db;

		const [existing] = await db<AutomoderatorReportPrompts[]>`
			SELECT * FROM automoderator_report_prompts WHERE id = ${promptId} AND guild_id = ${guildId}
		`;

		if (!existing) {
			throw notFound('report prompt not found');
		}

		const body = buildReportPromptBody(req.body as never, await getBotApplicationId('AUTOMODERATOR', guildId));

		try {
			await apiForGuild('AUTOMODERATOR', guildId).channels.editMessage(existing.channelId, existing.messageId, body);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 400 && 'prompt_raw' in req.body) {
				throw badData('invalid prompt_raw data');
			}

			if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage) {
				await db`DELETE FROM automoderator_report_prompts WHERE id = ${existing.id}`;
				throw notFound('that prompt message no longer exists on Discord, so it was removed -- post a new one');
			}

			throw error;
		}

		const [updated] = await db<AutomoderatorReportPrompts[]>`
			UPDATE automoderator_report_prompts
			SET prompt_json_data = ${JSON.stringify({ channelId: existing.channelId, ...req.body })}
			WHERE id = ${existing.id}
			RETURNING *
		`;

		return updated!;
	},
});
