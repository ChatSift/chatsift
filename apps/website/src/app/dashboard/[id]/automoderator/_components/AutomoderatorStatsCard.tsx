'use client';

import { automoderatorCasesChannel, automoderatorReportsChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { queryKeys } from '@/api/queryClient';
import { useAutomoderatorStats } from '@/api/routes/automoderator';
import { StatChip } from '@/components/stats/StatChip';
import { StatChipRow } from '@/components/stats/StatChipRow';
import { StatTile } from '@/components/stats/StatTile';
import { StatTileGrid } from '@/components/stats/StatTileGrid';
import { StatUserList } from '@/components/stats/StatUserList';
import { StatsCard } from '@/components/stats/StatsCard';
import type { StatValence } from '@/components/stats/statValence';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

// Ordered by escalation rather than by the enum's own order, so the row reads as a ladder. `valence` follows
// the same rule the case browser's action badges do: an action that removes somebody is bad, an action that
// gives them back access is good, a warning is neither.
const ACTION_CHIPS = [
	{ action: 'WARN', label: 'Warns', valence: 'neutral' },
	{ action: 'MUTE', label: 'Mutes', valence: 'bad' },
	{ action: 'UNMUTE', label: 'Unmutes', valence: 'good' },
	{ action: 'KICK', label: 'Kicks', valence: 'bad' },
	{ action: 'SOFTBAN', label: 'Softbans', valence: 'bad' },
	{ action: 'BAN', label: 'Bans', valence: 'bad' },
	{ action: 'UNBAN', label: 'Unbans', valence: 'good' },
] as const satisfies { action: string; label: string; valence: StatValence }[];

const REPORT_CHIPS = [
	{ state: 'OPEN', label: 'Open', valence: 'neutral' },
	{ state: 'ACTIONED', label: 'Actioned', valence: 'good' },
	{ state: 'DISMISSED', label: 'Dismissed', valence: 'bad' },
] as const satisfies { label: string; state: string; valence: StatValence }[];

/**
 * The hub page's "how much moderation is actually happening here" answer (#403), mirroring the AMA session
 * page's analytics card. Every breakdown chip is a pre-filtered link into the browser that already exists for
 * it -- `?action=`/`?state=` are exactly the params `CaseFilters`/`ReportFilters` read.
 */
export function AutomoderatorStatsCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();
	const { data: stats, isLoading, isError } = useAutomoderatorStats(guildId);

	// Two channels, because two tables feed this card: filing a case and resolving a report both change what it
	// says, and neither broadcast knows the other exists.
	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.stats(guildId) });
	};

	useRealtimeInvalidate(automoderatorCasesChannel(guildId), invalidate);
	useRealtimeInvalidate(automoderatorReportsChannel(guildId), invalidate);

	return (
		<StatsCard isError={isError} isLoading={isLoading}>
			{stats && (
				<div className="flex flex-col gap-6">
					<StatTileGrid columns={7}>
						<StatTile label="Total Cases" value={stats.cases.total} />
						<StatTile label="Last 30 Days" value={stats.cases.last30Days} />
						<StatTile label="Last 7 Days" value={stats.cases.last7Days} />
						<StatTile label="Active Punishments" value={stats.cases.active} />
						<StatTile label="Members Actioned" value={stats.cases.uniqueTargets} />
						<StatTile label="Automated" value={stats.cases.automated} />
						<StatTile label="Pardoned" value={stats.cases.pardoned} />
					</StatTileGrid>

					<StatChipRow title="Cases by Action">
						{ACTION_CHIPS.map(({ action, label, valence }) => (
							<Link
								className="rounded-md transition-opacity hover:opacity-80"
								href={`/dashboard/${guildId}/automoderator/cases?action=${action}`}
								key={action}
							>
								<StatChip
									label={label}
									valence={valence}
									value={stats.cases.byAction[action as keyof typeof stats.cases.byAction]}
								/>
							</Link>
						))}
					</StatChipRow>

					<StatChipRow title={`Reports (${stats.reports.total} total, ${stats.reports.last30Days} in 30 days)`}>
						{REPORT_CHIPS.map(({ state, label, valence }) => (
							<Link
								className="rounded-md transition-opacity hover:opacity-80"
								href={`/dashboard/${guildId}/automoderator/reports?state=${state}`}
								key={state}
							>
								<StatChip
									label={label}
									valence={valence}
									value={stats.reports.byState[state as keyof typeof stats.reports.byState]}
								/>
							</Link>
						))}
					</StatChipRow>

					{stats.topModerators.length > 0 && (
						<StatUserList
							countLabel={(count) => `${count} ${count === 1 ? 'case' : 'cases'}`}
							entries={stats.topModerators.map((moderator) => ({
								id: moderator.modId,
								storedTag: moderator.modTag,
								user: moderator.user,
								count: moderator.count,
							}))}
							title="Most Active Moderators"
						/>
					)}
				</div>
			)}
		</StatsCard>
	);
}
