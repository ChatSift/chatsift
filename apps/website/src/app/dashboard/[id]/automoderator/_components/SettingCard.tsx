import type { ReactNode } from 'react';

interface SettingCardProps {
	/**
	 * The control this card exists for -- a `SegmentedControl`, or a skeleton standing in for one.
	 */
	readonly control: ReactNode;
	readonly description: string;
	readonly error?: string | null;
	readonly title: string;
}

/**
 * One setting: what it is, what it does, and the control for it.
 *
 * The title and description are one column and the control is another, rather than the title alone sharing a
 * row with the control and the description running full-width underneath it. That earlier arrangement left a
 * `text-sm` heading marooned against the far edge of the card from a control twice its visual weight, with the
 * explanation for the control passing beneath it -- three separate reading orders in one card.
 */
export function SettingCard({ title, description, control, error }: SettingCardProps) {
	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark sm:flex-row sm:items-start sm:justify-between">
			<div className="flex flex-col gap-1">
				<h3 className="text-base font-medium text-primary dark:text-primary-dark">{title}</h3>
				<p className="text-sm text-secondary dark:text-secondary-dark">{description}</p>
			</div>

			<div className="flex flex-col items-start gap-1 sm:shrink-0 sm:items-end">
				{control}
				{error && <p className="text-sm text-misc-danger">{error}</p>}
			</div>
		</div>
	);
}
