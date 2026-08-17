import { reportStateSchema } from '@chatsift/api/automoderator-schemas';

/**
 * Display helpers shared by the report queue and the report detail, so the two can't disagree about what a
 * report looks like. Same split as `caseDisplay.ts`.
 */

/**
 * Derived from the API's own zod enum rather than hand-mirrored, so the filter can never offer a state the
 * route would reject -- the order is the schema's, which is also the order the filter should list them in.
 */
export const REPORT_STATES = reportStateSchema.options;

export const STATE_LABELS: Record<string, string> = {
	OPEN: 'Open',
	DISMISSED: 'Dismissed',
	ACTIONED: 'Actioned',
};

/**
 * Only tokens from `styles/globals.css`'s `@theme` block -- Tailwind's default palette is disabled in this app
 * (`--color-*: initial`), so `bg-red-500` would compile to nothing.
 *
 * `misc-system` carries a `-dark` variant that does **not** apply automatically, hence its explicit `dark:`
 * half; `misc-danger`/`misc-accent` are single values that work in both themes.
 */
export const STATE_PILL_CLASSES: Record<string, string> = {
	OPEN: 'bg-misc-danger/10 text-misc-danger',
	DISMISSED: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	ACTIONED: 'bg-misc-accent/10 text-misc-accent',
};

export function reporterCountLabel(count: number): string {
	return count === 1 ? '1 reporter' : `${count} reporters`;
}
