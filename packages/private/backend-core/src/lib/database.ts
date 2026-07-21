import type { Database } from '@chatsift/db';
import { createDb } from '@chatsift/db';
import { ENV } from './env.js';

/**
 * Creates the `postgres.js` raw SQL client (see docs/adr/0002-db-stack.md), attached to `getContext()` as `db`.
 */
export function createDatabase(): Database {
	return createDb({ url: ENV.IS_PRODUCTION ? ENV.DATABASE_URL_PROD : ENV.DATABASE_URL_DEV });
}
