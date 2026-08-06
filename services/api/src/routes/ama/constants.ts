import type { AmaQuestionState } from '@chatsift/db';

/**
 * Kept as a literal tuple rather than derived from the `ama_question_state` enum at runtime:
 * `AmaQuestionState` is `export type`-only (kanel generates it as a real enum, but `@chatsift/db`
 * only re-exports its type), so there's no runtime value to iterate here. Mirrors
 * `CREATE TYPE ama_question_state` in packages/private/db/schema/schema.sql.
 */
export const QUESTION_STATES = [
	'PENDING_MOD_REVIEW',
	'PENDING_GUEST_REVIEW',
	'FLAGGED',
	'APPROVED',
	'DENIED',
	'ASKED',
] as readonly AmaQuestionState[];
