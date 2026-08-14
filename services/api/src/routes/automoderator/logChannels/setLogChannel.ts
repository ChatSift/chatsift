import { encrypt, getContext } from '@chatsift/backend-core';
import { automoderatorLogChannelsChannel } from '@chatsift/core';
import type { AutomoderatorLogType, AutomoderatorLogWebhooks } from '@chatsift/db';
import { ChannelType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest, internal } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { assertChannelsBelongToGuild, fetchGuildChannels } from '../../../util/channels.js';
import { discordAPIAutomoderator, discordAPIWebhook } from '../../../util/discordAPI.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { WRITABLE_LOG_TYPES } from '../constants.js';
import { setLogChannelBodySchema } from '../schemas.js';
import type { LogChannelConfig } from './listLogChannels.js';

const bodySchema = setLogChannelBodySchema;
const paramsSchema = z.object({
	guildId: snowflakeSchema,
	logType: z.enum(['MOD']),
});

export type SetLogChannelBody = z.infer<typeof bodySchema>;
export type SetLogChannelResult = LogChannelConfig;

/**
 * Thread types, which webhooks can't be attached to directly -- the webhook belongs to the parent.
 */
const THREAD_TYPES = new Set<ChannelType>([
	ChannelType.PublicThread,
	ChannelType.PrivateThread,
	ChannelType.AnnouncementThread,
]);

export default defineRoute({
	method: 'put',
	path: '/v3/guilds/:guildId/automoderator/log-channels/:logType',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorLogChannelsChannel(req.params.guildId),
	async handler(req): Promise<SetLogChannelResult> {
		const { guildId, logType } = req.params;
		const { channelId } = req.body;
		const context = getContext();
		const logTypeValue = logType as unknown as AutomoderatorLogType;

		if (!WRITABLE_LOG_TYPES.includes(logTypeValue)) {
			throw badRequest('that log type cannot be configured yet');
		}

		// A bot's REST client is shared across every guild it's in, so without this a manager could point their
		// log at a channel in someone else's server.
		await assertChannelsBelongToGuild(guildId, [channelId], 'AUTOMODERATOR', context.logger);

		const channels = await fetchGuildChannels(guildId, 'AUTOMODERATOR');
		const channel = channels?.find((candidate) => candidate.id === channelId);

		if (!channel) {
			throw badRequest('that channel does not exist');
		}

		// A webhook belongs to the parent channel; posting into a thread is a `?thread_id=` on execute. That
		// split is why the row stores both.
		const isThread = THREAD_TYPES.has(channel.type);
		const webhookChannelId = isThread ? channel.parent_id : channel.id;
		const threadId = isThread ? channel.id : null;

		if (!webhookChannelId) {
			throw badRequest('that thread has no parent channel');
		}

		const db = context.db;
		const [existing] = await db<AutomoderatorLogWebhooks[]>`
			SELECT * FROM automoderator_log_webhooks WHERE guild_id = ${guildId} AND log_type = ${logTypeValue}
		`;

		let webhook;
		try {
			webhook = await discordAPIAutomoderator.channels.createWebhook(
				webhookChannelId,
				{ name: 'AutoModerator Logs' },
				{ reason: `Mod log configured by ${req.tokens!.access.sub}` },
			);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 403) {
				throw badRequest('I need the Manage Webhooks permission in that channel');
			}

			context.logger.error({ err: error, guildId, channelId }, 'failed to create a log webhook');
			throw internal('could not create a webhook in that channel');
		}

		if (!webhook.token) {
			throw internal('Discord returned a webhook without a token');
		}

		await db`
			INSERT INTO automoderator_log_webhooks (guild_id, log_type, channel_id, webhook_id, webhook_token, thread_id)
			VALUES (${guildId}, ${logTypeValue}, ${channel.id}, ${webhook.id}, ${encrypt(webhook.token)}, ${threadId})
			ON CONFLICT (guild_id, log_type) DO UPDATE SET
				channel_id = EXCLUDED.channel_id,
				webhook_id = EXCLUDED.webhook_id,
				webhook_token = EXCLUDED.webhook_token,
				thread_id = EXCLUDED.thread_id
		`;

		// Only after the row is safely replaced. Deleting first would leave the guild with no log at all if the
		// create above failed, and a webhook nobody references is otherwise a permanent clutter row in the
		// channel's integration settings.
		if (existing) {
			try {
				await discordAPIWebhook.webhooks.delete(existing.webhookId, {
					reason: 'Replaced by a new AutoModerator log webhook',
				});
			} catch (error) {
				context.logger.warn({ err: error, webhookId: existing.webhookId }, 'could not delete the replaced webhook');
			}
		}

		return { channelId: channel.id, logType: logTypeValue, threadId };
	},
});
