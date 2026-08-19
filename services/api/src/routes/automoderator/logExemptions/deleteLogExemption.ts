import { getContext } from '@chatsift/backend-core';
import { automoderatorLogExemptionsChannel } from '@chatsift/core';
import type { AutomoderatorLogExemptions } from '@chatsift/db';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	channelId: snowflakeSchema,
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/log-exemptions/:channelId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorLogExemptionsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, channelId } = req.params;

		// Guild-scoped, which is the whole reason this table is keyed on the pair rather than on `channel_id`
		// alone the way legacy's `log_ignores` was -- one guild's manager cannot delete another's row by
		// naming its channel.
		const [deleted] = await getContext().db<Pick<AutomoderatorLogExemptions, 'channelId'>[]>`
			DELETE FROM automoderator_log_exemptions
			WHERE guild_id = ${guildId} AND channel_id = ${channelId}
			RETURNING channel_id
		`;

		if (!deleted) {
			throw notFound('that channel is not exempt');
		}

		res.statusCode = 200;
		res.end();
	},
});
