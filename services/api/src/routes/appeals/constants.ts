import type { AppealKind, AppealStatus } from '@chatsift/db';

/**
 * Kept as literal tuples rather than derived from the enums at runtime: kanel generates both as real
 * TypeScript enums, but `@chatsift/db` only re-exports their types, so there is no runtime value to iterate.
 * Same arrangement as `ama/constants.ts` and `automoderator/constants.ts`. Mirrors `CREATE TYPE` in
 * packages/private/db/schema/schema.sql.
 */
export const APPEAL_STATUSES = ['PENDING', 'APPROVED', 'DENIED', 'WITHDRAWN', 'MOOT'] as readonly AppealStatus[];

export const APPEAL_KINDS = ['BAN', 'TIMEOUT'] as readonly AppealKind[];
