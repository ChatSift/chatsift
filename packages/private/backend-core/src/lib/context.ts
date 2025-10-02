import type { DB } from '@chatsift/core';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import { ENV } from './env.js';

export interface Context {
	BCRYPT_SALT_ROUNDS: number;
	UP_SINCE: number;

	db: Kysely<DB>;
	env: typeof ENV;
	logger: Logger;
}

export function createContext(db: Kysely<DB>, logger: Logger): Context {
	return {
		UP_SINCE: Date.now(),
		BCRYPT_SALT_ROUNDS: 14,

		db,
		env: ENV,
		logger,
	};
}
