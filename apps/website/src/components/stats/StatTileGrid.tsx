import type { ReactNode } from 'react';

/**
 * The responsive row `StatTile`s sit in. `columns` is the count at `lg` and above only -- narrower
 * breakpoints are fixed at 2/3, since a seven-across row of tiles is unreadable on a phone no matter what
 * the page asked for.
 */
export function StatTileGrid({
	children,
	columns = 4,
}: {
	readonly children: ReactNode;
	readonly columns?: 4 | 5 | 6 | 7;
}) {
	// Spelled out rather than interpolated: Tailwind scans source text for whole class names, so a
	// `lg:grid-cols-${columns}` template would compile to nothing at all.
	const lgColumns = {
		4: 'lg:grid-cols-4',
		5: 'lg:grid-cols-5',
		6: 'lg:grid-cols-6',
		7: 'lg:grid-cols-7',
	}[columns];

	return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${lgColumns}`}>{children}</div>;
}
