import type { StatValence } from './statValence';
import { valenceClass } from './statValence';

interface StatChipProps {
	readonly label: string;
	readonly valence?: StatValence;
	readonly value: number | string;
}

/**
 * Compact number+label pill. Lifted out of the Triage page's old `QuestionStatsSummary` (removed in #322, it
 * duplicated the Overview card's tiles) -- the pill itself is still the right shape wherever a breakdown's
 * length is unbounded and a tile grid would fall apart: AMA's per-tag counts, ModMail's per-category ticket
 * counts, Social's busiest interactions (#403).
 */
export function StatChip({ label, valence = 'neutral', value }: StatChipProps) {
	return (
		<span className="flex items-center gap-1.5 rounded-md border border-on-secondary bg-card px-2.5 py-1 text-xs dark:border-on-secondary-dark dark:bg-card-dark">
			<span className={`font-semibold ${valenceClass[valence]}`}>{value}</span>
			<span className="text-secondary dark:text-secondary-dark">{label}</span>
		</span>
	);
}
