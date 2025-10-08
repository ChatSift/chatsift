import process from 'node:process';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

const envSchema = z.object({
	// General
	IS_PRODUCTION: z.coerce.boolean().default(false),
	ROOT_DOMAIN: z.string(),
	ADMINS: z
		.string()
		.optional()
		.transform((value) => value?.split(', '))
		.pipe(z.array(z.string().regex(SnowflakeRegex)).optional())
		.transform((value) => (value ? new Set(value) : new Set())),

	// Postgres
	DATABASE_URL: z.string(),

	// Redis
	REDIS_URL: z.string(),

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
	API_URL: z.url(),
	FRONTEND_URL: z.url(),

	// AMA
	AMA_BOT_TOKEN: z.string(),
});

export const ENV = envSchema.parse(process.env);
