import { appealStatusSchema } from '@chatsift/api/appeals-schemas';
import type { AppealListItem } from '@/api/routes/appeals';

/**
 * Display helpers shared by the appeals queue and the appeal detail, so the two can't disagree about what an
 * appeal looks like. Same split as `reportDisplay.ts`.
 */

/**
 * Derived from the API's own zod enum rather than hand-mirrored, so the filter can never offer a status the
 * route would reject -- the order is the schema's, which is also the order the filter should list them in.
 */
export const APPEAL_STATUSES = appealStatusSchema.options;

export const STATUS_LABELS: Record<string, string> = {
	PENDING: 'Pending',
	APPROVED: 'Approved',
	DENIED: 'Denied',
	WITHDRAWN: 'Withdrawn',
	MOOT: 'No longer banned',
};

/**
 * Only tokens from `web-core`'s `theme.css` -- Tailwind's default palette is disabled (`--color-*: initial`),
 * so `bg-green-500` would compile to nothing at all.
 *
 * A `MOOT` close is styled like a withdrawal rather than like an approval: nobody decided it, and colouring it
 * as a win would claim a decision that was never taken.
 */
export const STATUS_PILL_CLASSES: Record<string, string> = {
	PENDING: 'bg-misc-danger/10 text-misc-danger',
	APPROVED: 'bg-misc-accent/10 text-misc-accent',
	DENIED: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	WITHDRAWN: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	MOOT: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
};

/**
 * What a row's pill says. A silent denial is a `DENIED` row like any other and says so **here**, on the mod
 * surface -- it is only `unban.app` that is told it is still pending (decision 6), and that mapping lives
 * server-side in `toPublicAppeal` where no dashboard code can reach it.
 */
export function statusLabel(appeal: Pick<AppealListItem, 'silent' | 'status'>): string {
	if (appeal.status === 'DENIED' && appeal.silent) {
		return 'Denied silently';
	}

	return STATUS_LABELS[appeal.status] ?? appeal.status;
}

export function isAppealDecided(appeal: Pick<AppealListItem, 'status'>): boolean {
	return appeal.status !== 'PENDING';
}
