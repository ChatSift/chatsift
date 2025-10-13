import type { DB } from '@chatsift/core';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { ENV } from './env.js';
import type { createRedis } from './redis.js';

export interface Context {
	API_URL: string;
	BCRYPT_SALT_ROUNDS: number;
	FRONTEND_URL: string;
	UP_SINCE: number;

	db: Kysely<DB>;
	env: typeof ENV;
	logger: Logger;
	redis: Awaited<ReturnType<typeof createRedis>>;
}

export function createContext(given: Pick<Context, 'db' | 'logger' | 'redis'>): Context {
	return {
		API_URL: ENV.IS_PRODUCTION ? ENV.API_URL_PROD : ENV.API_URL_DEV,
		BCRYPT_SALT_ROUNDS: 14,
		FRONTEND_URL: ENV.IS_PRODUCTION ? ENV.FRONTEND_URL_PROD : ENV.FRONTEND_URL_DEV,
		UP_SINCE: Date.now(),

		env: ENV,
		...given,
	};
}
