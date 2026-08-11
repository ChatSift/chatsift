import { Buffer } from 'node:buffer';
import process from 'node:process';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

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
	// phase onward (it registers/deletes the per-guild interaction commands), so a deployment without it
	// would fail at the first interaction write rather than at boot. Custom instances are a ModMail-only
	// concept, so there's no per-instance counterpart here.
	SOCIAL_BOT_TOKEN: z.string(),

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
