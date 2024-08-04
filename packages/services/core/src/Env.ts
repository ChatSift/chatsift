import process from 'node:process';
import { SnowflakeRegex } from '@sapphire/discord-utilities';
import type { Logger } from 'pino';
import { z } from 'zod';
import { globalContainer, INJECTION_TOKENS } from './container.js';

const BOTS = ['automoderator'] as const;

export const botSchema = z.enum(BOTS);

export type BotKind = z.infer<typeof botSchema>;

const envSchema = z.object({
	// General config
	NODE_ENV: z.enum(['dev', 'prod']).default('prod'),
	LOGS_DIR: z.string(),
	ROOT_DOMAIN: z.string(),

	// DB
	POSTGRES_HOST: z.string(),
	POSTGRES_PORT: z.string().pipe(z.coerce.number()),
	POSTGRES_USER: z.string(),
	POSTGRES_PASSWORD: z.string(),
	POSTGRES_DATABASE: z.string(),

	// Redis
	REDIS_URL: z.string().url(),

	// Bot config
	ADMINS: z
		.string()
		.transform((value) => value.split(', '))
		.pipe(z.array(z.string().regex(SnowflakeRegex)))
		.transform((value) => new Set(value)),

	AUTOMODERATOR_DISCORD_TOKEN: z.string(),
	AUTOMODERATOR_DISCORD_CLIENT_ID: z.string().regex(SnowflakeRegex),
	AUTOMODERATOR_GATEWAY_URL: z.string().url(),
	AUTOMODERATOR_PROXY_URL: z.string().url(),

	// API
	API_PORT: z.number(),
	PUBLIC_API_URL_DEV: z.string().url(),
	PUBLIC_API_URL_PROD: z.string().url(),
	SECRET_SIGNING_KEY: z.string().length(44),
	OAUTH_DISCORD_CLIENT_ID: z.string().regex(SnowflakeRegex),
	OAUTH_DISCORD_CLIENT_SECRET: z.string(),
	CORS: z.string().transform((value, ctx) => {
		try {
			return new RegExp(value);
		} catch {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Not a valid regular expression',
			});
		}
	}),
	ALLOWED_API_ORIGINS: z
		.string()
		.transform((value) => value.split(','))
		.pipe(z.array(z.string().url()).min(1)),

	// Bot service specific
	BOT: botSchema,
});

export const Env = envSchema.parse(process.env);

export interface BotCredentials {
	clientId: string;
	gatewayURL: string;
	proxyURL: string;
	token: string;
}

let loggedForCredentials = false;

export function credentialsForCurrentBot(): BotCredentials {
	const logger = globalContainer.get<Logger>(INJECTION_TOKENS.logger);

	if (!loggedForCredentials) {
		logger.info(`Retrieving credentials for bot ${Env.BOT}`);
		loggedForCredentials = true;
	}

	switch (Env.BOT) {
		case 'automoderator': {
			return {
				token: Env.AUTOMODERATOR_DISCORD_TOKEN,
				clientId: Env.AUTOMODERATOR_DISCORD_CLIENT_ID,
				proxyURL: Env.AUTOMODERATOR_PROXY_URL,
				gatewayURL: Env.AUTOMODERATOR_GATEWAY_URL,
			};
		}

		// This should never happen
		default: {
			throw new Error('process.env.BOT is not set or is invalid');
		}
	}
}

export const API_URL = Env.NODE_ENV === 'dev' ? Env.PUBLIC_API_URL_DEV : Env.PUBLIC_API_URL_PROD;
