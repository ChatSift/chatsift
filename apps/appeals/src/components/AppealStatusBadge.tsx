import type { PublicAppealStatus } from '@chatsift/api';

/**
 * How each public status reads to the appellant, and the one place that copy lives.
 *
 * `'PENDING'` is what a silent denial serializes to (decision 6), so this label is doing double duty by
 * design -- it has to be true of a genuinely open appeal and give nothing away about a closed one. "Under
 * review" is both.
 *
 * `'MOOT'` is an appeal whose ban was lifted somewhere other than here (P4b). Worded as the fact rather than as
 * an outcome, and styled neutrally rather than like an approval, because nobody approved it -- telling them
 * their appeal succeeded when a moderator simply unbanned them for unrelated reasons is a claim we cannot make.
 */
const LABELS: Record<PublicAppealStatus, string> = {
	PENDING: 'Under review',
	APPROVED: 'Approved',
	DENIED: 'Denied',
	WITHDRAWN: 'Withdrawn',
	MOOT: 'No longer banned',
};

const STYLES: Record<PublicAppealStatus, string> = {
	PENDING: 'bg-misc-system/10 text-misc-system dark:text-misc-system-dark',
	APPROVED: 'bg-misc-accent/10 text-misc-accent',
	DENIED: 'bg-misc-danger/10 text-misc-danger',
	WITHDRAWN: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
	MOOT: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
};

export function AppealStatusBadge({ status }: { readonly status: PublicAppealStatus }) {
	return <span className={`rounded-md px-2 py-1 text-sm font-medium ${STYLES[status]}`}>{LABELS[status]}</span>;
}
