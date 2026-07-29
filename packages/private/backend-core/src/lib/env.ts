import process from 'node:process';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

const envSchema = z.object({
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
	// Length of a base64-encoded 32-byte key. Used for JWT signing and encryption
	ENCRYPTION_KEY: z.string().length(44),
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

	// Dozzle log webhook relay (issue #212) — Dozzle POSTs here with a raw-JSON embed description,
	// we prettify it and forward to the real Discord webhook
	DOZZLE_WEBHOOK_SECRET: z.string(),
	DOZZLE_WEBHOOK_DISCORD_ID: z.string().regex(SnowflakeRegex),
	DOZZLE_WEBHOOK_DISCORD_TOKEN: z.string(),
});

export const ENV = envSchema.parse(process.env);
