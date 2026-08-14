import { Buffer } from 'node:buffer';
import process from 'node:process';
import { URL } from 'node:url';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

// An absent *or empty* proxy base URL, both meaning "not configured". The empty case isn't pedantry:
// docker-compose's `env_file` turns a bare `FOO=` into an empty string rather than leaving it unset, so a
// plain `z.url().optional()` would reject the most natural way to switch an optional URL off.
//
// Everything past the protocol check exists because `REST` builds request URLs as `${api}/v${version}${route}`
// and the proxy strips a leading `/api(/v\d+)?` back off. Anything but exactly `/api` silently desynchronizes
// those two -- `discord-proxy:7005` parses as scheme `discord-proxy:`, a bare origin makes `REST` emit
// `/v10/...` that the proxy won't recognize, and a trailing slash produces a `//v10/...` that misses its
// strip regex. All three fail far from here, as confusing runtime 404s, so they're rejected at boot instead.
const discordProxyUrl = z
	.string()
	.trim()
	.transform((value) => (value === '' ? undefined : value))
	.pipe(z.url({ protocol: /^https?$/ }).optional())
	.optional()
	.refine(
		(value) => {
			if (value === undefined) {
				return true;
			}

			const url = new URL(value);
			return url.pathname === '/api' && url.search === '' && url.hash === '';
		},
		{ message: 'must be an origin followed by exactly /api, with no trailing slash, query or fragment' },
	);

// Exported (in addition to the parsed `ENV` singleton below) so tests can exercise individual fields
// via `.safeParse()` against a valid base object, without needing to mutate `process.env` and
// re-import the module for every case -- see `__tests__/env.test.ts`.
export const envSchema = z.object({
	// General
	IS_PRODUCTION: z.stringbool().default(false),
	ROOT_DOMAIN: z.string(),
	ADMINS: z
		.string()
		.optional()
		.transform((value) => value?.split(', '))
		.pipe(z.array(z.string().regex(SnowflakeRegex)).optional())
		.transform((value) => (value ? new Set(value) : new Set())),

	// API
	API_PORT: z.string().pipe(z.coerce.number()),
	OAUTH_DISCORD_CLIENT_ID: z.string().regex(SnowflakeRegex),
	OAUTH_DISCORD_CLIENT_SECRET: z.string(),
	CORS: z.string().transform((value, ctx) => {
		try {
			return new RegExp(value);
		} catch {
			ctx.addIssue({
				code: 'custom',
				message: 'Not a valid regular expression',
			});
			return z.NEVER;
		}
	}),
	// Base64-encoded 32-byte key. Used for JWT signing and encryption (packages/private/backend-core's
	// crypt.ts) -- `.length(44)` alone only checks the string's *character* length, which a
	// wrong-length/malformed value can still satisfy (e.g. base64 for a 31 or 33-byte key can also come
	// out to 44 chars with padding); decoding it and checking the real byte length catches those instead
	// of failing later, confusingly, inside `createCipheriv`/`jwt.sign`.
	ENCRYPTION_KEY: z
		.string()
		.length(44)
		.refine((value) => Buffer.from(value, 'base64').length === 32, {
			message: 'ENCRYPTION_KEY must be a base64-encoded 32-byte key',
		}),
	API_URL_DEV: z.url(),
	API_URL_PROD: z.url(),
	FRONTEND_URL_DEV: z.url(),
	FRONTEND_URL_PROD: z.url(),

	// DB (packages/db — postgres.js raw SQL client, see docs/adr/0002-db-stack.md)
	DATABASE_URL_DEV: z.url(),
	DATABASE_URL_PROD: z.url(),

	// Redis
	REDIS_URL_DEV: z.url({ protocol: /^rediss?$/ }),
	REDIS_URL_PROD: z.url({ protocol: /^rediss?$/ }),

	// Proxy
	DISCORD_PROXY_PORT: z.string().pipe(z.coerce.number()),
	DISCORD_PROXY_URL_DEV: discordProxyUrl,
	DISCORD_PROXY_URL_PROD: discordProxyUrl,

	// Horizontal scaling (#355). The only number an operator sets: how many gateway shards one replica should
	// aim to run. Everything else is derived -- Discord's `/gateway/bot` recommendation decides the shard count,
	// and each replica works out which slice is its own against redis (`bot-core/src/lib/replica.ts`).
	// Absent means "one replica runs every shard", which is the current topology for every bot. Set per bot in
	// that service's own docker-compose `environment:` block, like `MODMAIL_INSTANCE_ID` above, since bots do not
	// grow at the same rate and a single shared value would be wrong for most of them.
	// Blank is treated as absent (rather than as `0`) for the same reason the proxy URLs above are: these live in
	// shared env files where a documented-but-empty key is the normal way to say "not configured here".
	//
	// Base-10 digits only, deliberately narrower than `Number()`: `./compose` validates the same value with a
	// `^[0-9]+$` check to size `--scale`, and `Number()` would accept `1e3`/`0x10` here so a deployment could
	// pass this schema and then fail at deploy time instead. The two must agree on what a valid value looks like.
	SHARDS_PER_REPLICA: z
		.string()
		.trim()
		.regex(/^(?:\d+)?$/, 'must be a base-10 integer (or empty for "not configured")')
		.transform((value) => (value === '' ? undefined : Number(value)))
		.pipe(z.number().int().positive().optional())
		.optional(),

	// AMA
	AMA_BOT_TOKEN: z.string(),

	// ModMail
	MODMAIL_BOT_TOKEN: z.string(),
	// Set only on a custom-instance deployment (#216, docs/roadmap/01-architecture.md §8), in
	// that service's own docker-compose `environment:` block -- never in .env.public/.env.private,
	// since it must differ per partner deployment sharing the same env files. Absent (the public
	// deployment) means "this process is the public ModMail instance".
	MODMAIL_INSTANCE_ID: z.string().trim().min(1).optional(),

	// Social (#343). Required like every other bot token: services/api needs it from the Social port's API
	// phase onward (it registers/deletes the per-guild interaction commands). Like every field here it's
	// validated by the `envSchema.parse` at the bottom of this module, which runs at import time -- so a
	// deployment missing it fails at startup, not at the first interaction write. Custom instances are a
	// ModMail-only concept, so there's no per-instance counterpart here.
	SOCIAL_BOT_TOKEN: z.string(),

	// AutoModerator (docs/roadmap/11-automoderator-port.md). Required like every other bot token --
	// services/api needs it from P0 onward, since the dashboard reads the guild's channels/roles through
	// whichever bot the page is scoped to.
	AUTOMODERATOR_BOT_TOKEN: z.string(),
	// Port the bot binds its Prometheus `/metrics` listener on, and only in production -- see
	// `automoderator-bot`'s `metricsServer.ts` for why collection is unconditional but exposure is not.
	AUTOMODERATOR_METRICS_PORT: z.string().pipe(z.coerce.number()),

	// Dozzle log webhook relay (issue #212) — Dozzle POSTs here with a raw-JSON embed description,
	// we prettify it and forward to the real Discord webhook
	DOZZLE_WEBHOOK_SECRET: z.string(),
	DOZZLE_WEBHOOK_DISCORD_ID: z.string().regex(SnowflakeRegex),
	DOZZLE_WEBHOOK_DISCORD_TOKEN: z.string(),

	// Metrics (#277) — guards the API's `/metrics` Prometheus scrape endpoint via a Bearer token
	// (see requireMetricsSecret.ts). Same value must also be mirrored into the gitignored
	// build/prometheus/metrics_secret file Prometheus reads its scrape credentials from.
	METRICS_SECRET: z.string(),
});

export const ENV = envSchema.parse(process.env);
