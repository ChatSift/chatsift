import type { ReactNode } from 'react';

/**
 * A titled wrap of `StatChip`s under an analytics card's tile grid -- the breakdowns whose length the guild
 * controls (tags, categories, rewards, interactions), which is why they are chips rather than more tiles.
 */
export function StatChipRow({ children, title }: { readonly children: ReactNode; readonly title: string }) {
	return (
		<div>
			<h3 className="mb-2 text-sm font-medium text-primary dark:text-primary-dark">{title}</h3>
			<div className="flex flex-wrap gap-2">{children}</div>
		</div>
	);
}
