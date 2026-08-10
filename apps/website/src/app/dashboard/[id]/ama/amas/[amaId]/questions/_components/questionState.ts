import { MERGE_TARGET_STATES } from '@chatsift/core';

/**
 * The dashboard's own names for the raw `ama_question_state` values -- what the state tabs are called,
 * so a chip on a row reads the same as the tab it filters to. Lived inline in `QuestionsList.tsx` until
 * the merge pickers needed them too (#328 lets a merge target be in any of three states, so the pickers
 * have to say which).
 */
export const STATE_LABELS: Record<string, string> = {
	PENDING_REVIEW: 'Pending Review',
	APPROVED: 'Guest Questions',
	ASKED: 'Asked Questions',
	DENIED: 'Denied',
};

// Mirrors `questionStateTiles.ts`'s valence (neutral/good/bad) so a state means the same thing everywhere
// in the AMA dashboard -- a flat single color across all states (the original version of this chip) made
// "Denied" look identical to "Asked", which reads as a mistake, not a status.
export const STATE_CHIP_CLASSES: Record<string, string> = {
	PENDING_REVIEW: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	APPROVED: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	ASKED: 'bg-misc-accent/10 text-misc-accent',
	DENIED: 'bg-misc-danger/10 text-misc-danger',
};

export const DEFAULT_STATE_CHIP_CLASS =
	'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark';

/**
 * The `states` filter both merge pickers pass to `listQuestions` so only questions that can actually
 * absorb a duplicate (#328) are offered as targets. Filtered server-side rather than over the fetched
 * page: filtering client-side lets a 25-row page render zero matches while `hasNextPage` is still true,
 * which reads as "no results" when there are plenty further down.
 */
export const MERGE_TARGET_STATES_PARAM = [...MERGE_TARGET_STATES].join(',');
