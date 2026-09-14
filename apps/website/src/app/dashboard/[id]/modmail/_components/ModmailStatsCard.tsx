'use client';

import { formatCaseDuration } from '@chatsift/core';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useModmailStats } from '@/api/routes/modmail';
import { StatChip } from '@/components/stats/StatChip';
import { StatChipRow } from '@/components/stats/StatChipRow';
import { StatTile } from '@/components/stats/StatTile';
import { StatTileGrid } from '@/components/stats/StatTileGrid';
import { StatsCard } from '@/components/stats/StatsCard';

/**
 * The hub page's "how much mail is this server actually handling" answer (#403), mirroring the AMA session
 * page's analytics card. Category chips deep-link into the ticket browser pre-filtered -- `?category=` is the
 * param `CategoryFilter` reads.
 */
export function ModmailStatsCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: stats, isLoading, isError } = useModmailStats(guildId);

	return (
		<StatsCard isError={isError} isLoading={isLoading}>
			{stats && (
				<div className="flex flex-col gap-6">
					<StatTileGrid columns={7}>
						<StatTile label="Total Tickets" value={stats.threads.total} />
						<StatTile label="Open" valence="good" value={stats.threads.open} />
						<StatTile label="Closed" value={stats.threads.closed} />
						<StatTile label="Last 30 Days" value={stats.threads.last30Days} />
						<StatTile label="Last 7 Days" value={stats.threads.last7Days} />
						<StatTile label="Unique Users" value={stats.threads.uniqueUsers} />
						<StatTile
							label="Avg. Time Open"
							// `formatCaseDuration` takes ms and rounds to one coarse unit, which is what an average
							// wants -- "2 days", not "1 day 22 hours 14 minutes".
							value={
								stats.threads.avgTimeToCloseSeconds === null
									? '--'
									: formatCaseDuration(stats.threads.avgTimeToCloseSeconds * 1_000)
							}
						/>
					</StatTileGrid>

					{/* Message counts are only as complete as the guild's recording setting -- a ticket relayed while
					`record_thread_content` was off still counts here (the `thread_messages` row is always written),
					so these are volume, not transcript coverage. */}
					<StatTileGrid columns={5}>
						<StatTile label="Messages Relayed" value={stats.messages.total} />
						<StatTile label="From Users" value={stats.messages.user} />
						<StatTile label="From Staff" value={stats.messages.staff} />
						<StatTile label="Internal Notes" value={stats.messages.internalNotes} />
						<StatTile
							label="Blocked Users"
							valence={stats.threads.blockedUsers > 0 ? 'bad' : 'neutral'}
							value={stats.threads.blockedUsers}
						/>
					</StatTileGrid>

					{stats.byCategory.length > 0 && (
						<StatChipRow title="Tickets by Category">
							{stats.byCategory.map((category) =>
								// The uncategorised bucket has no filter to link to -- `CategoryFilter` only ever sets a
								// numeric id, and there is no "no category" option to send someone to.
								category.id === null ? (
									<StatChip key="uncategorised" label={category.name} value={category.count} />
								) : (
									<Link
										className="rounded-md transition-opacity hover:opacity-80"
										href={`/dashboard/${guildId}/modmail/threads?category=${category.id}&include_closed=true`}
										key={category.id}
									>
										<StatChip label={category.name} value={category.count} />
									</Link>
								),
							)}
						</StatChipRow>
					)}
				</div>
			)}
		</StatsCard>
	);
}
