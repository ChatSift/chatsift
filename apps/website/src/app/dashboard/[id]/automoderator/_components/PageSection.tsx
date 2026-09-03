import type { ReactNode } from 'react';

/**
 * A titled block within a page that holds more than one thing: the hub's section groups, and the Logging and
 * Exemptions pages, which each merged two former sub-pages. Without the title, two cards in a row read as one
 * setting split in half.
 */
export function PageSection({ title, children }: { readonly children: ReactNode; readonly title: string }) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-xs font-medium uppercase tracking-wide text-secondary dark:text-secondary-dark">{title}</h2>
			{children}
		</div>
	);
}
