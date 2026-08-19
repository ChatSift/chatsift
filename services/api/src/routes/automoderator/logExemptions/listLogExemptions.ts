import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorLogExemptions } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface LogExemption {
	channelId: string;
}

export type ListLogExemptionsResult = LogExemption[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/log-exemptions',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListLogExemptionsResult> {
		return getContext().db<Pick<AutomoderatorLogExemptions, 'channelId'>[]>`
			SELECT channel_id FROM automoderator_log_exemptions
			WHERE guild_id = ${req.params.guildId}
			ORDER BY channel_id ASC
		`;
	},
});
