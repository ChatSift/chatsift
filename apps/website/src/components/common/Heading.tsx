import type { ReactNode } from 'react';

interface HeadingProps {
	readonly subtitle?: string | undefined;
	readonly title: string;
	/**
	 * A badge or control belonging to the title, rendered on the title's own row.
	 */
	readonly trailing?: ReactNode;
}

const TITLE_CLASS = 'text-2xl font-medium text-primary dark:text-primary-dark';

export function Heading({ title, subtitle, trailing }: HeadingProps) {
	return (
		<div className="flex flex-col">
			{trailing ? (
				<div className="flex flex-wrap items-center gap-3">
					<p className={TITLE_CLASS}>{title}</p>
					{trailing}
				</div>
			) : (
				<p className={TITLE_CLASS}>{title}</p>
			)}
			{subtitle && <p className="text-lg font-normal text-secondary dark:text-secondary-dark">{subtitle}</p>}
		</div>
	);
}
