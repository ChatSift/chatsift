import { getContext, getReportsChannelId } from '@chatsift/backend-core';
import type { AutomoderatorReportPrompts } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badData, badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild } from '../../../util/channels.js';
import { apiForGuild } from '../../../util/discordAPI.js';
import { getBotApplicationId } from '../../../util/discordApplication.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { createReportPromptBodySchema } from '../schemas.js';
import { buildReportPromptBody } from './util.js';

const bodySchema = createReportPromptBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateReportPromptBody = z.input<typeof bodySchema>;
export type CreateReportPromptResult = AutomoderatorReportPrompts;

export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/automoderator/report-prompts',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<CreateReportPromptResult> {
		const { guildId } = req.params;
		const db = getContext().db;

		// Refused rather than posted with a caveat: a prompt inviting members to report DMs into a server that
		// has nowhere to put them sends people through a five-step install to reach a picker this guild will not
		// appear in -- and the picker is deliberately vague about why, so they would never find out.
		if (!(await getReportsChannelId(guildId))) {
			throw badRequest('set a reports channel before posting a report prompt');
		}

		await assertChannelsBelongToGuild(guildId, [req.body.channelId], 'AUTOMODERATOR', req.logger);

		const api = apiForGuild('AUTOMODERATOR', guildId);
		const body = buildReportPromptBody(req.body, await getBotApplicationId('AUTOMODERATOR', guildId));

		let message;
		try {
			message = await api.channels.createMessage(req.body.channelId, body);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 400 && 'prompt_raw' in req.body) {
				throw badData('invalid prompt_raw data');
			}

			if (
				error instanceof DiscordAPIError &&
				(error.code === RESTJSONErrorCodes.MissingAccess || error.code === RESTJSONErrorCodes.MissingPermissions)
			) {
				throw badRequest('the bot cannot post in that channel');
			}

			throw error;
		}

		// The stored copy is what the message *is*, so an edit can rebuild it without re-reading Discord -- the
		// same reason `ticket_panels.panel_json_data` exists.
		const [created] = await db<AutomoderatorReportPrompts[]>`
			INSERT INTO automoderator_report_prompts (guild_id, channel_id, message_id, prompt_json_data)
			VALUES (${guildId}, ${req.body.channelId}, ${message.id}, ${JSON.stringify(req.body)})
			RETURNING *
		`;

		return created!;
	},
});
