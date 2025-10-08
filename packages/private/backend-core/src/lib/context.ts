import type { DB } from '@chatsift/core';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { ENV } from './env.js';
import type { createRedis } from './redis.js';

export interface Context {
	BCRYPT_SALT_ROUNDS: number;
	UP_SINCE: number;

	db: Kysely<DB>;
	env: typeof ENV;
	logger: Logger;
	redis: Awaited<ReturnType<typeof createRedis>>;
}

export function createContext(given: Pick<Context, 'db' | 'logger' | 'redis'>): Context {
	return {
		BCRYPT_SALT_ROUNDS: 14,
		UP_SINCE: Date.now(),

		env: ENV,
		...given,
	};
}
