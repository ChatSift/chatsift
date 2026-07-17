import type { Database } from '@chatsift/db';
import type { Logger } from 'pino';
import { ENV } from './env.js';
import type { createRedis } from './redis.js';

export interface Context {
	API_URL: string;
	BCRYPT_SALT_ROUNDS: number;
	FRONTEND_URL: string;
	UP_SINCE: number;

	/**
	 * `postgres.js` raw SQL client (docs/adr/0002-db-stack.md).
	 */
	db: Database;
	env: typeof ENV;
	logger: Logger;
	redis: Awaited<ReturnType<typeof createRedis>>;
}

let context: Context | null = null;

export function initContext(given: Pick<Context, 'db' | 'logger' | 'redis'>): void {
	if (context !== null) {
		throw new Error('Context has already been initialized');
	}

	context = {
		API_URL: ENV.IS_PRODUCTION ? ENV.API_URL_PROD : ENV.API_URL_DEV,
		BCRYPT_SALT_ROUNDS: 14,
		FRONTEND_URL: ENV.IS_PRODUCTION ? ENV.FRONTEND_URL_PROD : ENV.FRONTEND_URL_DEV,
		UP_SINCE: Date.now(),

		env: ENV,
		...given,
	};
}

export function getContext(): Context {
	if (!context) {
		throw new Error('Context has not been initialized yet');
	}

	return context;
}
