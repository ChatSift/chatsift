import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorLogType, AutomoderatorLogWebhooks } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface LogChannelConfig {
	channelId: string;
	logType: AutomoderatorLogType;
	threadId: string | null;
}

export type ListLogChannelsResult = LogChannelConfig[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/log-channels',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListLogChannelsResult> {
		const { guildId } = req.params;

		return getContext().db<Pick<AutomoderatorLogWebhooks, 'channelId' | 'logType' | 'threadId'>[]>`
			SELECT channel_id, log_type, thread_id FROM automoderator_log_webhooks WHERE guild_id = ${guildId}
		`;
	},
});
