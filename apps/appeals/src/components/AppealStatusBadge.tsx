import type { PublicAppealStatus } from '@chatsift/api';

/**
 * How each public status reads to the appellant, and the one place that copy lives.
 *
 * `'PENDING'` is what a silent denial serializes to (decision 6), so this label is doing double duty by
 * design -- it has to be true of a genuinely open appeal and give nothing away about a closed one. "Under
 * review" is both.
 *
 * `'NEEDS_MORE_INFO'` is unreachable until P4 ships the ask-for-more-info exchange; it is labelled here
 * anyway so the status can never render as a raw enum value the first time a moderator uses it.
 */
const LABELS: Record<PublicAppealStatus, string> = {
	PENDING: 'Under review',
	NEEDS_MORE_INFO: 'More information needed',
	APPROVED: 'Approved',
	DENIED: 'Denied',
	WITHDRAWN: 'Withdrawn',
};

const STYLES: Record<PublicAppealStatus, string> = {
	PENDING: 'bg-misc-system/10 text-misc-system dark:text-misc-system-dark',
	NEEDS_MORE_INFO: 'bg-misc-warning/10 text-misc-warning dark:text-misc-warning-dark',
	APPROVED: 'bg-misc-accent/10 text-misc-accent',
	DENIED: 'bg-misc-danger/10 text-misc-danger',
	WITHDRAWN: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark',
};

export function AppealStatusBadge({ status }: { readonly status: PublicAppealStatus }) {
	return <span className={`rounded-md px-2 py-1 text-sm font-medium ${STYLES[status]}`}>{LABELS[status]}</span>;
}
