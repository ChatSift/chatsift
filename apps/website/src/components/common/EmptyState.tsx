import type { ReactNode } from 'react';

interface EmptyStateProps {
	readonly icon: ReactNode;
	readonly subtitle: string;
	readonly title: string;
}

export function EmptyState({ icon, subtitle, title }: EmptyStateProps) {
	return (
		<div className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-on-secondary bg-card p-8 text-center dark:border-on-secondary-dark dark:bg-card-dark">
			{icon}
			<p className="text-lg font-medium text-primary dark:text-primary-dark">{title}</p>
			<p className="text-sm text-secondary dark:text-secondary-dark">{subtitle}</p>
		</div>
	);
}
