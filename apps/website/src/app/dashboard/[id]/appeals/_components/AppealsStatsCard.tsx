'use client';

import { appealsQueueChannel, formatCaseDuration } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { queryKeys } from '@/api/queryClient';
import { useAppealsStats } from '@/api/routes/appeals';
import { StatChip } from '@/components/stats/StatChip';
import { StatChipRow } from '@/components/stats/StatChipRow';
import { StatTile } from '@/components/stats/StatTile';
import { StatTileGrid } from '@/components/stats/StatTileGrid';
import { StatUserList } from '@/components/stats/StatUserList';
import { StatsCard } from '@/components/stats/StatsCard';
import type { StatValence } from '@/components/stats/statValence';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

// PENDING is neutral rather than warning: a queue with appeals in it is the system working, not a problem.
// WITHDRAWN and MOOT are outcomes nobody decided, so neither gets a decision's colour.
const STATUS_CHIPS = [
	{ status: 'PENDING', label: 'Pending', valence: 'neutral' },
	{ status: 'APPROVED', label: 'Approved', valence: 'good' },
	{ status: 'DENIED', label: 'Denied', valence: 'bad' },
	{ status: 'WITHDRAWN', label: 'Withdrawn', valence: 'neutral' },
	{ status: 'MOOT', label: 'Moot', valence: 'neutral' },
] as const satisfies { label: string; status: string; valence: StatValence }[];

/**
 * The hub page's "what is this queue actually doing" answer (#403), mirroring the AMA session page's analytics
 * card. Status chips deep-link into the queue pre-filtered -- `?status=` is the param `AppealFilters` reads.
 */
export function AppealsStatsCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();
	const { data: stats, isLoading, isError } = useAppealsStats(guildId);

	useRealtimeInvalidate(appealsQueueChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.stats(guildId) });
	});

	return (
		<StatsCard isError={isError} isLoading={isLoading}>
			{stats && (
				<div className="flex flex-col gap-6">
					<StatTileGrid columns={7}>
						<StatTile label="Total Appeals" value={stats.total} />
						<StatTile label="Last 30 Days" value={stats.last30Days} />
						<StatTile label="Last 7 Days" value={stats.last7Days} />
						<StatTile label="Unique Appellants" value={stats.uniqueAppellants} />
						<StatTile
							label="Approval Rate"
							// Null, not zero, until something has been decided -- "0%" would read as a guild that
							// turns everyone down rather than one that has not started.
							value={stats.approvalRate === null ? '--' : `${Math.round(stats.approvalRate * 100)}%`}
						/>
						<StatTile
							label="Avg. Decision Time"
							value={
								stats.avgDecisionTimeSeconds === null ? '--' : formatCaseDuration(stats.avgDecisionTimeSeconds * 1_000)
							}
						/>
						<StatTile label="Unappealable Users" value={stats.unappealableUsers} />
					</StatTileGrid>

					<StatChipRow title="Appeals by Status">
						{STATUS_CHIPS.map(({ status, label, valence }) => (
							<Link
								className="rounded-md transition-opacity hover:opacity-80"
								href={`/dashboard/${guildId}/appeals/queue?status=${status}`}
								key={status}
							>
								<StatChip
									label={label}
									valence={valence}
									value={stats.byStatus[status as keyof typeof stats.byStatus]}
								/>
							</Link>
						))}
					</StatChipRow>

					<StatChipRow title="Appeals by Punishment">
						<StatChip label="Ban appeals" value={stats.byKind.BAN} />
						<StatChip label="Timeout appeals" value={stats.byKind.TIMEOUT} />
						{/* Only ever a subset of the denials above, and deliberately alongside them rather than in the
						status row: a silent denial is a denial the appellant will never see, which is worth its own
						line for anyone auditing how the queue is run. */}
						<StatChip label="Silent denials" valence="bad" value={stats.silentDenials} />
					</StatChipRow>

					{stats.topDeciders.length > 0 && (
						<StatUserList
							countLabel={(count) => `${count} ${count === 1 ? 'decision' : 'decisions'}`}
							entries={stats.topDeciders.map((decider) => ({
								id: decider.deciderId,
								// No appeals table stores a username snapshot, so there is nothing to prefer over the
								// live account here -- unlike an AutoModerator case.
								storedTag: null,
								user: decider.user,
								count: decider.count,
							}))}
							title="Most Active Deciders"
						/>
					)}
				</div>
			)}
		</StatsCard>
	);
}
