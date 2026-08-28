import { getContext } from '@chatsift/backend-core';
import { automoderatorFilterExemptionsChannel } from '@chatsift/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	channelId: snowflakeSchema,
});

/**
 * Drops a channel from the exemption list entirely, every filter at once. Removing a single filter is a PUT
 * with the remaining ones -- "exempt from nothing" is not a state the table can hold, so it is this route.
 */
export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/filter-exemptions/:channelId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorFilterExemptionsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, channelId } = req.params;

		const deleted = await getContext().db`
			DELETE FROM automoderator_filter_exemptions
			WHERE guild_id = ${guildId} AND channel_id = ${channelId}
		`;

		if (deleted.count === 0) {
			throw notFound('that channel is not exempt from any filter');
		}

		res.statusCode = 200;
		res.end();
	},
});
