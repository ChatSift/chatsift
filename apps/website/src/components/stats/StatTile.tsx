import type { StatValence } from './statValence';
import { valenceClass } from './statValence';

interface StatTileProps {
	readonly label: string;
	readonly valence?: StatValence;
	readonly value: number | string;
}

/**
 * One number-over-label tile in an analytics card. Shared across every bot's card (#403) rather than copied
 * per page -- the AMA session page's grid was the original and is now one caller among five.
 */
export function StatTile({ label, value, valence = 'neutral' }: StatTileProps) {
	return (
		<div className="rounded-lg border border-on-secondary p-4 text-center dark:border-on-secondary-dark">
			<p className={`text-2xl font-semibold ${valenceClass[valence]}`}>{value}</p>
			<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">{label}</p>
		</div>
	);
}
