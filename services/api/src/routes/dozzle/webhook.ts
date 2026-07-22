import { getContext } from '@chatsift/backend-core';
import type { RESTPostAPIWebhookWithTokenJSONBody } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badGateway } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { requireWebhookSecret } from '../../middleware/requireWebhookSecret.js';
import { discordAPIWebhook } from '../../util/discordAPI.js';

// Discord embed description hard limit
const EMBED_DESCRIPTION_MAX = 4_096;
const TRUNCATION_SUFFIX = '\n... (truncated)\n```';

const embedSchema = z.looseObject({
	description: z.string().optional(),
});

const bodySchema = z.looseObject({
	embeds: z.array(embedSchema).optional(),
});

/**
 * Dozzle's webhook templates can only emit a flattened `JSON.stringify` string (no indent, no
 * `text/template` function to pretty-print it) — see #212. Any embed description that's itself a
 * JSON document gets re-indented and fenced as a code block in place before relaying to Discord.
 */
function prettifyJsonDescriptions(embeds: z.infer<typeof embedSchema>[] | undefined): void {
	for (const embed of embeds ?? []) {
		if (!embed.description) {
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(embed.description);
		} catch {
			continue;
		}

		const pretty = `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
		embed.description =
			pretty.length <= EMBED_DESCRIPTION_MAX
				? pretty
				: pretty.slice(0, EMBED_DESCRIPTION_MAX - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
	}
}

export default defineRoute({
	method: 'post',
	path: '/v3/logs/webhook',
	middleware: [requireWebhookSecret()],
	schema: { body: bodySchema },
	async handler(req, res) {
		prettifyJsonDescriptions(req.body.embeds);

		const { env } = getContext();
		try {
			// Dozzle's payload shape is admin-controlled (via its own template UI), not something we can pin
			// down to `APIEmbed`'s `exactOptionalPropertyTypes`-strict shape ahead of time — we've already
			// validated it's a plausible webhook body above, so relay it through as-is.
			await discordAPIWebhook.webhooks.execute(
				env.DOZZLE_WEBHOOK_DISCORD_ID,
				env.DOZZLE_WEBHOOK_DISCORD_TOKEN,
				req.body as unknown as RESTPostAPIWebhookWithTokenJSONBody,
			);
		} catch (error) {
			if (error instanceof DiscordAPIError) {
				throw badGateway('discord rejected the relayed webhook payload', error);
			}

			throw error;
		}

		res.statusCode = 204;
		res.end();
	},
});
