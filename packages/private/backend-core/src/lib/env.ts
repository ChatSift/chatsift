import process from 'node:process';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

const envSchema = z.object({
	// General
	IS_PRODUCTION: z.coerce.boolean().default(false),
	ADMINS: z
		.string()
		.transform((value) => value.split(', '))
		.pipe(z.array(z.string().regex(SnowflakeRegex)))
		.transform((value) => new Set(value)),

	// API
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
	API_PORT: z.string().pipe(z.coerce.number()),
	// Length of a base64-encoded 32-byte key. Used for JWT signing and encryption
	ENCRYPTION_KEY: z.string().length(44),

	// Postgres
	DATABASE_URL: z.string(),
});

export const ENV = envSchema.parse(process.env);
