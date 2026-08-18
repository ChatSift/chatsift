import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorReportPrompts } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badGateway, notFound } from '@hapi/boom';
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

		const db = getContext().db;

		const [existing] = await db<AutomoderatorReportPrompts[]>`
			SELECT * FROM automoderator_report_prompts WHERE id = ${promptId} AND guild_id = ${guildId}
		`;

		if (!existing) {
			throw notFound('report prompt not found');
		}

		// **Discord first, row second** -- the opposite order to `deletePanel`, deliberately. Dropping the row and
		// firing the message deletion off unawaited means a failure that is not "already gone" (the bot lost
		// Manage Messages, a 5xx) leaves a live prompt with a working install button in the channel and no row
		// left to find or retry it from -- while the confirmation dialog has already told staff the message was
		// removed. This way that failure is visible and retryable. The reverse risk is self-healing: a row left
		// pointing at a deleted message 404s into `updateReportPrompt`'s cleanup, and a second delete takes the
		// `UnknownMessage` path below.
		try {
			await apiForGuild('AUTOMODERATOR', guildId).channels.deleteMessage(existing.channelId, existing.messageId);
		} catch (error) {
			// Already deleted by hand is exactly the state this endpoint was asked to produce, so it counts as
			// success and falls through to dropping the row.
			if (!(error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage)) {
				req.logger.warn({ err: error, guildId, promptId }, 'failed to delete a report prompt message on Discord');
				throw badGateway('could not delete the prompt message on Discord -- check the bot can still post there');
			}
		}

		await db`DELETE FROM automoderator_report_prompts WHERE id = ${existing.id}`;

		res.statusCode = 200;
		res.end();
	},
});
