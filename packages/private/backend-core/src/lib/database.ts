import type { Database } from '@chatsift/db';
import { createDb } from '@chatsift/db';
import { ENV } from './env.js';
import type { Logger } from './logger.js';

/**
 * Creates the `postgres.js` raw SQL client (see docs/adr/0002-db-stack.md), attached to `getContext()` as `db`.
 *
 * `logger` drives slow-query logging (#270, threshold shared with Postgres's own
 * `log_min_duration_statement` via `POSTGRES_SLOW_QUERY_LOG_MS`) -- the app-level complement to the
 * DB-side `pg_stat_statements`/`postgres-exporter` setup, see `packages/private/db/src/index.ts`.
 */
export function createDatabase(logger: Logger): Database {
	return createDb({
		slowQuery: { logger, thresholdMs: ENV.POSTGRES_SLOW_QUERY_LOG_MS },
		url: ENV.IS_PRODUCTION ? ENV.DATABASE_URL_PROD : ENV.DATABASE_URL_DEV,
	});
}
