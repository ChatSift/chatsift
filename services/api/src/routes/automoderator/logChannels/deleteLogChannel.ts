import { getContext } from '@chatsift/backend-core';
import { automoderatorLogChannelsChannel } from '@chatsift/core';
import type { AutomoderatorLogType, AutomoderatorLogWebhooks } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIWebhook } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { writableLogTypeSchema } from '../schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	logType: writableLogTypeSchema,
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/log-channels/:logType',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorLogChannelsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, logType } = req.params;
		const context = getContext();

		const [deleted] = await context.db<AutomoderatorLogWebhooks[]>`
			DELETE FROM automoderator_log_webhooks
			WHERE guild_id = ${guildId} AND log_type = ${logType as unknown as AutomoderatorLogType}
			RETURNING *
		`;

		if (!deleted) {
			throw notFound('no log channel is configured for that type');
		}

		try {
			await discordAPIWebhook.webhooks.delete(deleted.webhookId, { reason: 'AutoModerator log channel unset' });
		} catch (error) {
			context.logger.warn({ err: error, webhookId: deleted.webhookId }, 'could not delete the unset webhook');
		}

		res.statusCode = 200;
		res.end();
	},
});
