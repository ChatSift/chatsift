import type { AutomoderatorCaseAction, AutomoderatorLogType } from '@chatsift/db';

/**
 * Kept as literal tuples rather than derived from the enums at runtime: kanel generates
 * `automoderator_case_action`/`automoderator_log_type` as real TypeScript enums, but `@chatsift/db` only
 * re-exports their types, so there is no runtime value to iterate. Same arrangement as `ama/constants.ts`.
 * Mirrors `CREATE TYPE` in packages/private/db/schema/schema.sql.
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

/**
 * Only MOD is writable at P1, even though the column's type has all four values. FILTER, MESSAGE and USER
 * land with the phases that dispatch into them (P5, P4) -- offering a log channel nothing ever writes to would
 * be a configuration screen that quietly does nothing.
 */
export const WRITABLE_LOG_TYPES = ['MOD'] as readonly AutomoderatorLogType[];
