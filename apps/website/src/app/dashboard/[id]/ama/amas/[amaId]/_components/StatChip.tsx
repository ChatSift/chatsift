import { valenceClass } from './questionStateTiles';

interface StatChipProps {
	readonly label: string;
	readonly valence?: keyof typeof valenceClass;
	readonly value: number;
}

/**
 * Compact number+label pill. Lifted out of the Triage page's old `QuestionStatsSummary` (removed in #322,
 * it duplicated the Overview card's tiles) -- the pill itself is still the right shape for the per-tag
 * counts in `AMADetails.tsx`'s "Analytics & Export" card, where a tile grid would fall apart once a
 * session has more than a handful of tags.
 */
export function StatChip({ label, valence = 'neutral', value }: StatChipProps) {
	return (
		<span className="flex items-center gap-1.5 rounded-md border border-on-secondary bg-card px-2.5 py-1 text-xs dark:border-on-secondary-dark dark:bg-card-dark">
			<span className={`font-semibold ${valenceClass[valence]}`}>{value}</span>
			<span className="text-secondary dark:text-secondary-dark">{label}</span>
		</span>
	);
}
