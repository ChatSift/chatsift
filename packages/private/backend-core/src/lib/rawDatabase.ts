import type { Database } from '@chatsift/db';
import { createDb } from '@chatsift/db';
import { ENV } from './env.js';

/**
 * Creates the `postgres.js` raw SQL client (see docs/adr/0002-db-stack.md). Attached to `getContext()` as `rawDb`,
 * coexisting with the legacy Kysely `db` field until every route is migrated off it (docs/roadmap/02-foundation.md
 * Part C) and `db` itself can be replaced.
 */
export function createRawDatabase(): Database {
	return createDb({ url: ENV.DATABASE_URL });
}
