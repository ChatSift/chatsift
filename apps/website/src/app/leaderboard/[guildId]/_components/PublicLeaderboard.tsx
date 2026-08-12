'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FaExclamationCircle } from 'react-icons/fa';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import {
	publicSocialLeaderboardWsTicketPath,
	SOCIAL_LEADERBOARD_PAGE_SIZE,
	usePublicSocialLeaderboard,
} from '@/api/routes/social';
import { EmptyState } from '@/components/common/EmptyState';
import { GenericAvatar } from '@/components/common/GenericAvatar';
import { LeaderboardPager, LeaderboardTable, LeaderboardTableSkeleton } from '@/components/social/LeaderboardTable';
import { usePublicRealtimeClient } from '@/hooks/usePublicRealtimeClient';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { getGuildAcronym } from '@/utils/util';

/**
 * Unauthenticated, read-only view of a guild's XP leaderboard. Lives outside `/dashboard` entirely, the same
 * "outside the authenticated tree" placement as `/ama-answers` and `/privacy`.
 *
 * Addressed by the plain guild id rather than a share token: see the dashboard's `PublicLeaderboardCard` for
 * why, and `services/api`'s `toPublicUserInfo` for exactly how much of a member this payload does and doesn't
 * carry (less than the invariant this once claimed -- avatar URLs embed a user id).
 */
export function PublicLeaderboard() {
	const { guildId } = useParams<{ guildId: string }>();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);

	const realtimeClient = usePublicRealtimeClient(publicSocialLeaderboardWsTicketPath(guildId));
	const { data, isLoading, isFetching, error } = usePublicSocialLeaderboard(guildId, page);

	// Live for the same reason the dashboard's copy is: this list moves every time anyone in the server talks.
	// The channel comes off the response rather than being built here purely to keep one source of truth for
	// the string, and is undefined until the first fetch resolves -- which the hook already no-ops on. A guild
	// that switches the page off publishes on this same channel, so watchers refetch straight onto the 404.
	useRealtimeInvalidate(
		data?.realtimeChannel,
		() => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.social.publicLeaderboard(guildId) });
		},
		realtimeClient,
	);

	if (isLoading) {
		return <LeaderboardTableSkeleton />;
	}

	// A 404 wins even with data still cached: that's what a guild switching the page off looks like arriving
	// over the realtime channel, and continuing to render a ranking that was just unpublished would be the one
	// failure mode worth being strict about. Any *other* error keeps stale-but-real data on screen instead of
	// claiming the leaderboard doesn't exist, which a transient 500 shouldn't be allowed to say.
	const isGone = error instanceof APIError && error.statusCode === 404;
	if (isGone || !data) {
		return (
			<EmptyState
				icon={<FaExclamationCircle className="h-8 w-8 text-misc-danger" />}
				subtitle={
					isGone
						? 'This server either has no public leaderboard, or has turned it off.'
						: 'Something went wrong loading this leaderboard. It may be worth trying again in a moment.'
				}
				title={isGone ? 'Leaderboard not found' : "Couldn't load the leaderboard"}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				{/* `GenericAvatar` rather than a bare image, the same component the rows below use: it brings the
				    initials fallback, so a server with no icon (or one this bot can no longer read) still gets a
				    marker instead of a gap. Not `GuildIcon` -- that one takes a whole `MeGuild`, which is exactly
				    the authenticated shape this page deliberately never has. */}
				<GenericAvatar
					assetURL={data.guildIconUrl ?? undefined}
					className="h-10 w-10 rounded-full"
					disableLink
					initials={getGuildAcronym(data.guildName ?? 'Server')}
					isLoading={false}
				/>
				<h1 className="text-2xl font-semibold text-primary dark:text-primary-dark">
					{data.guildName ? `${data.guildName} leaderboard` : 'Leaderboard'}
				</h1>
			</div>

			{data.entries.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">Nobody has earned any XP here yet.</p>
			) : (
				<>
					<LeaderboardTable curve={data.curve} entries={data.entries} isRefreshing={isFetching} />
					<LeaderboardPager
						onPageChange={setPage}
						page={page}
						pageSize={SOCIAL_LEADERBOARD_PAGE_SIZE}
						total={data.total}
					/>
				</>
			)}
		</div>
	);
}
