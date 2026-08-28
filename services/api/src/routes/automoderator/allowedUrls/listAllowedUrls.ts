import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorAllowedUrls } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

/**
 * A domain the URL filter lets through. Just the host -- it is stored already normalised (see
 * `normalizeAllowedDomain` in `@chatsift/core`), so what the dashboard renders is exactly what the bot matches
 * against.
 */
export interface AllowedUrl {
	readonly domain: string;
}

export type ListAllowedUrlsResult = AllowedUrl[];

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/automoderator/allowed-urls',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<ListAllowedUrlsResult> {
		const rows = await getContext().db<Pick<AutomoderatorAllowedUrls, 'domain'>[]>`
			SELECT domain FROM automoderator_allowed_urls WHERE guild_id = ${req.params.guildId} ORDER BY domain ASC
		`;

		// `.toString()` because kanel brands primary-key columns.
		return rows.map((row) => ({ domain: row.domain.toString() }));
	},
});
