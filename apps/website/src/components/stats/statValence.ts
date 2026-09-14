/**
 * How a stat's number should be coloured. Lifted out of the AMA session page's `questionStateTiles.ts` when
 * every other bot grew the same kind of analytics card (#403): accent for a good outcome, danger for a bad
 * one, neutral for a count that is neither (a total, or a state still awaiting a decision -- borrowing a
 * colour there would misrepresent it).
 */
export type StatValence = 'bad' | 'good' | 'neutral';

export const valenceClass = {
	neutral: 'text-primary dark:text-primary-dark',
	good: 'text-misc-accent',
	bad: 'text-misc-danger',
} as const satisfies Record<StatValence, string>;
