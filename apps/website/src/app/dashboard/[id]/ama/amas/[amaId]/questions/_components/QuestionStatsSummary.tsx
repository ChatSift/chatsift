'use client';

import { useParams } from 'next/navigation';
import { QUESTION_STATE_TILES, valenceClass } from '../../_components/questionStateTiles';
import type { AMAStats } from '@/api/routes/ama';
import { useAMAStats } from '@/api/routes/ama';

/**
 * Compact stat chips for the Triage page -- same numbers as `AMADetails.tsx`'s full "Analytics &
 * Export" card, just small pills instead of a whole card, so they fit right above the tabs without
 * dominating the page. Doesn't need its own realtime subscription, since `QuestionsList.tsx` already
 * invalidates the shared `ama.stats` query (see `invalidateAMAQuestions`) on the same channel this page
 * is already subscribed to.
 */
export function QuestionStatsSummary() {
	const params = useParams<{ amaId: string; id: string }>();
	const { data: stats } = useAMAStats(params.id, params.amaId);

	if (!stats) {
		return null;
	}

	return (
		<div className="flex flex-wrap gap-2">
			<StatChip label="Total" value={stats.total} />
			{QUESTION_STATE_TILES.map(({ state, label, valence }) => (
				<StatChip
					key={state}
					label={label}
					valence={valence}
					value={stats.byState[state as keyof AMAStats['byState']]}
				/>
			))}
			<StatChip label="Merged Duplicates" value={stats.mergedDuplicatesCount} />
		</div>
	);
}

interface StatChipProps {
	readonly label: string;
	readonly valence?: keyof typeof valenceClass;
	readonly value: number;
}

function StatChip({ label, valence = 'neutral', value }: StatChipProps) {
	return (
		<span className="flex items-center gap-1.5 rounded-md border border-on-secondary bg-card px-2.5 py-1 text-xs dark:border-on-secondary-dark dark:bg-card-dark">
			<span className={`font-semibold ${valenceClass[valence]}`}>{value}</span>
			<span className="text-secondary dark:text-secondary-dark">{label}</span>
		</span>
	);
}
