'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { FaComments, FaSearch } from 'react-icons/fa';
import { AMASessionCard } from './AMASessionCard';
import { CreateAMACard } from './CreateAMACard';
import type { SortOption } from './SortMenu';
import { useSortOption } from './SortMenu';
import type { AMASessionWithCount } from '@/api/routes/ama';
import { useAMAs } from '@/api/routes/ama';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useGuildAccess } from '@/hooks/useGuildAccess';

function AMASessionSkeleton() {
	return (
		<div className="flex h-36 w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-col gap-1">
				<Skeleton className="h-7 w-3/4" />
				<Skeleton className="h-5 w-1/2" />
			</div>
			<div className="mt-auto flex items-center gap-2">
				<Skeleton className="h-6 w-16" />
			</div>
		</div>
	);
}

function sortSessions(sessions: AMASessionWithCount[], sort: SortOption): AMASessionWithCount[] {
	const sorted = [...sessions];

	switch (sort) {
		case 'newest':
			return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
		case 'oldest':
			return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
		case 'title':
			return sorted.sort((a, b) => a.title.localeCompare(b.title));
		case 'questions':
			return sorted.sort((a, b) => b.questionCount - a.questionCount);
	}
}

export function AMASessionsList() {
	const params = useParams<{ id: string }>();
	const searchParams = useSearchParams();
	const sort = useSortOption();

	const searchQuery = searchParams.get('search') ?? '';
	// Everything is listed by default; the toggle narrows down to sessions still accepting questions (#299).
	const openOnly = searchParams.get('open_only') === 'true';

	const { data: sessions, isLoading, error } = useAMAs(params.id, !openOnly);
	// Creating a session is manager-only -- a guest only ever sees the specific AMA(s) they're scoped to
	// (already filtered server-side, see `getAMAs.ts`), so there's nothing for a "create" card to do here.
	const { canManage } = useGuildAccess(params.id);
	const createCardItem = canManage ? (
		<li>
			<CreateAMACard />
		</li>
	) : null;

	const filtered = useMemo(() => {
		if (!sessions?.length) {
			return [];
		}

		const lower = searchQuery.toLowerCase();
		const matching = sessions.filter((session) => session.title.toLowerCase().includes(lower));
		return sortSessions(matching, sort);
	}, [sessions, searchQuery, sort]);

	// See GrantsList.tsx for why this also checks `sessions === undefined`: a background refetch failure keeps
	// the previously-cached list around, and that stale-but-present data should keep rendering normally rather
	// than being replaced by the full error state.
	if (error && sessions === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
				{createCardItem}
				{Array.from({ length: 3 }).map((_, index) => (
					<li key={index}>
						<AMASessionSkeleton />
					</li>
				))}
			</ul>
		);
	}

	if (!sessions?.length) {
		return (
			<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
				{createCardItem}
				<li className="md:col-span-2 lg:col-span-3">
					{openOnly ? (
						<EmptyState
							icon={<FaComments className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
							subtitle='There may be closed sessions hidden - turn off "Hide Closed" above to see them.'
							title="No AMA sessions accepting questions"
						/>
					) : (
						<EmptyState
							icon={<FaComments className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
							subtitle={
								canManage
									? 'Create your first AMA session to get started.'
									: 'Sessions show up here once a server manager adds you as a guest on one.'
							}
							title={canManage ? 'No AMA sessions yet' : 'No AMA sessions shared with you'}
						/>
					)}
				</li>
			</ul>
		);
	}

	if (filtered.length === 0) {
		return (
			<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
				{createCardItem}
				<li className="md:col-span-2 lg:col-span-3">
					<EmptyState
						icon={<FaSearch className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
						subtitle={`No AMA sessions match "${searchQuery}".`}
						title="No results"
					/>
				</li>
			</ul>
		);
	}

	return (
		<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
			{createCardItem}
			{filtered.map((session) => (
				<li key={session.id}>
					<AMASessionCard data={session} />
				</li>
			))}
		</ul>
	);
}
