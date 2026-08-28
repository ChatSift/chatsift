import { getContext } from '@chatsift/backend-core';
import { ALLOWED_URL_MAX_COUNT, automoderatorAllowedUrlsChannel, normalizeAllowedDomain } from '@chatsift/core';
import type { AutomoderatorAllowedUrls } from '@chatsift/db';
import { badRequest } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { allowedUrlBodySchema } from '../schemas.js';
import type { AllowedUrl } from './listAllowedUrls.js';

const bodySchema = allowedUrlBodySchema;
const paramsSchema = z.object({ guildId: snowflakeSchema });

export type CreateAllowedUrlBody = z.input<typeof bodySchema>;
export type CreateAllowedUrlResult = AllowedUrl;

/**
 * Adds a domain to the URL filter's allowlist (P5b, feature 02).
 *
 * POST rather than a PUT keyed on the domain, because the row's identity is not what the client sent: whatever
 * they pasted is normalised to a bare host first, so `https://Example.com/pricing` and `example.com` are the
 * same row. Returning the stored value is the point -- a PUT would have to echo back a path parameter it had
 * quietly rewritten.
 */
export default defineRoute({
	method: 'post',
	path: '/v3/guilds/:guildId/automoderator/allowed-urls',
	schema: { body: bodySchema, params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	realtimeChannel: (req) => automoderatorAllowedUrlsChannel(req.params.guildId),
	async handler(req): Promise<CreateAllowedUrlResult> {
		const { guildId } = req.params;

		// The single definition of what an entry means, shared with the bot's matcher and the dashboard's live
		// preview. A zod pattern here instead would be a second definition able to disagree with it.
		const domain = normalizeAllowedDomain(req.body.domain);
		if (domain === null) {
			throw badRequest("that doesn't look like a domain -- try something like example.com");
		}

		// Cap enforced inside the insert, same shape and the same deliberate looseness as the log-exemption and
		// bypass-role routes -- see `logExemptions/setLogExemption.ts` for why it is a bound rather than an
		// invariant. `DO UPDATE` exists purely so `RETURNING` still yields a row for a domain already listed,
		// which is what lets "already allowed" and "over the cap" be told apart.
		const [row] = await getContext().db<Pick<AutomoderatorAllowedUrls, 'domain'>[]>`
			INSERT INTO automoderator_allowed_urls (guild_id, domain)
			SELECT ${guildId}, ${domain}
			WHERE (
				SELECT count(*) FROM automoderator_allowed_urls
				WHERE guild_id = ${guildId} AND domain <> ${domain}
			) < ${ALLOWED_URL_MAX_COUNT}
			ON CONFLICT (guild_id, domain) DO UPDATE SET domain = EXCLUDED.domain
			RETURNING domain
		`;

		if (!row) {
			throw badRequest(`a server can allow at most ${ALLOWED_URL_MAX_COUNT} domains`);
		}

		return { domain };
	},
});
