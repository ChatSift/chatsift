import type { AutomoderatorCaseAction, AutomoderatorReportState } from '@chatsift/db';

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

/**
 * Mirrors `CREATE TYPE automoderator_report_state`, kept as a literal tuple for the same reason
 * `CASE_ACTIONS` is.
 */
export const REPORT_STATES = ['OPEN', 'DISMISSED', 'ACTIONED'] as readonly AutomoderatorReportState[];
