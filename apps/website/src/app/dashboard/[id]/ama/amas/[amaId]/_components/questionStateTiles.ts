// Shared between `AMADetails.tsx`'s full stat card and the `analytics/` subpage's simplified one, so a
// state's label/color can't drift between the two views. Labels mirror the Triage page's tab names
// (`QuestionStateTabs.tsx`) -- "Guest Questions"/"Asked Questions" describe who acts on/what happens to
// a question in that state, not the raw `PENDING_REVIEW`/`APPROVED`/`ASKED` state name.
//
// `valence` picks the count's color the same way the Status badge on `AMADetails.tsx` colors
// "Active"/"Ended": accent for a good outcome, danger for a bad one. PENDING_REVIEW is still awaiting a
// decision, so it stays neutral rather than borrowing a color that would misrepresent it as good or bad.
// `APPROVED` no longer means "posted" (#293 follow-up) -- with prepared answers on, it means "approved,
// awaiting an answer/send" (i.e. handed to a guest), so it stays neutral too; `ASKED` is the "actually
// posted" terminal state.
//
// `state` is a plain string literal here, not `keyof AMAStats['byState']` -- that type resolves to a
// (nominal) TS string enum, which plain literals aren't assignable to without a cast. Cast once at each
// `stats.byState[state]` read site instead of on every tuple entry.
export const QUESTION_STATE_TILES = [
	{ state: 'PENDING_REVIEW', label: 'Pending Review', valence: 'neutral' },
	{ state: 'APPROVED', label: 'Guest Questions', valence: 'neutral' },
	{ state: 'ASKED', label: 'Asked Questions', valence: 'good' },
	{ state: 'DENIED', label: 'Denied', valence: 'bad' },
] as const satisfies { label: string; state: string; valence: 'bad' | 'good' | 'neutral' }[];

export const valenceClass = {
	neutral: 'text-primary dark:text-primary-dark',
	good: 'text-misc-accent',
	bad: 'text-misc-danger',
} as const satisfies Record<(typeof QUESTION_STATE_TILES)[number]['valence'], string>;
