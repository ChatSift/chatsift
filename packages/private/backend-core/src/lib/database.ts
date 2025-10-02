import type { DB } from '@chatsift/core';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Logger } from 'pino';
import { ENV } from './env.js';

export function createDatabase(logger: Logger): Kysely<DB> {
	const pool = new Pool({
		connectionString: ENV.DATABASE_URL,
	});

	const dialect = new PostgresDialect({
		pool,
	});

	return new Kysely<DB>({
		dialect,
		log: (event) => {
			if (event.level === 'error') {
				logger.error({ query: event.query.sql, err: event.error }, 'Query responsible for error');
			} else if (event.level === 'query') {
				logger.debug({ query: event.query.sql, duration: event.queryDurationMillis }, 'Executed query');
			}
		},
	});
}
