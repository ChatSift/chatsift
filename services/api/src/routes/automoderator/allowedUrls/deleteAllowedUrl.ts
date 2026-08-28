import { getContext } from '@chatsift/backend-core';
import { ALLOWED_URL_MAX_LENGTH, automoderatorAllowedUrlsChannel } from '@chatsift/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	// The stored value, verbatim -- the client deletes a row the list route handed it, so there is nothing to
	// normalise here and normalising anyway would let a near-miss silently delete a neighbouring entry.
	domain: z.string().min(1).max(ALLOWED_URL_MAX_LENGTH),
});

export default defineRoute({
	method: 'delete',
	path: '/v3/guilds/:guildId/automoderator/allowed-urls/:domain',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorAllowedUrlsChannel(req.params.guildId),
	async handler(req, res): Promise<void> {
		const { guildId, domain } = req.params;

		const deleted = await getContext().db`
			DELETE FROM automoderator_allowed_urls WHERE guild_id = ${guildId} AND domain = ${domain}
		`;

		if (deleted.count === 0) {
			throw notFound('that domain is not on the allowlist');
		}

		res.statusCode = 200;
		res.end();
	},
});
