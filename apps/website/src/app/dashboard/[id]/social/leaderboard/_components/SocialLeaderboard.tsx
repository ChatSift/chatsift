'use client';

import { socialLeaderboardChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FaTrophy } from 'react-icons/fa';
import { queryKeys } from '@/api/queryClient';
import { SOCIAL_LEADERBOARD_PAGE_SIZE, useSocialLeaderboard } from '@/api/routes/social';
import { EmptyState } from '@/components/common/EmptyState';
import { LeaderboardPager, LeaderboardTable, LeaderboardTableSkeleton } from '@/components/social/LeaderboardTable';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

export function SocialLeaderboard() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);

	const { data, isLoading, isFetching, error } = useSocialLeaderboard(guildId, page);

	// Every XP grant in the server moves this list, so it's one of the few dashboard pages where live updates
	// are the point rather than a nicety. The bot coalesces the signal (see its `leaderboardBroadcast.ts`),
	// and the key here is the section prefix so whichever pages are cached all refresh together.
	useRealtimeInvalidate(socialLeaderboardChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.social.leaderboard(guildId) });
	});

	// See GrantsList.tsx: a background refetch failure keeps the previously-cached page around, and that
	// stale-but-present data should keep rendering rather than being replaced by the full error state.
	if (error && data === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data) {
		return <LeaderboardTableSkeleton />;
	}

	if (data.entries.length === 0) {
		return (
			<EmptyState
				icon={<FaTrophy className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
				subtitle="Members appear here once they have earned XP. Nobody has yet."
				title="No ranks yet"
			/>
		);
	}

	return (
		<div className="space-y-4">
			{/* `isFetching` rather than `isLoading`: with `placeholderData` holding the previous page on screen,
			    `isLoading` is only ever true on the very first load, which the skeleton above already covers. */}
			<LeaderboardTable curve={data.curve} entries={data.entries} isRefreshing={isFetching} />
			<LeaderboardPager onPageChange={setPage} page={page} pageSize={SOCIAL_LEADERBOARD_PAGE_SIZE} total={data.total} />
			{data.curve === null && (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Levels aren&apos;t shown because this server has no XP curve configured yet -- members are accruing XP with
					nothing to reach.
				</p>
			)}
		</div>
	);
}
