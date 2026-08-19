import type { AutomoderatorCaseAction } from '@chatsift/db';

/**
 * Kept as a literal tuple rather than derived from the enum at runtime: kanel generates
 * `automoderator_case_action` as a real TypeScript enum, but `@chatsift/db` only re-exports its type, so there
 * is no runtime value to iterate. Same arrangement as `ama/constants.ts`. Mirrors `CREATE TYPE` in
 * packages/private/db/schema/schema.sql.
 */
export const CASE_ACTIONS = [
	'WARN',
	'MUTE',
	'UNMUTE',
	'KICK',
	'SOFTBAN',
	'BAN',
	'UNBAN',
] as readonly AutomoderatorCaseAction[];
