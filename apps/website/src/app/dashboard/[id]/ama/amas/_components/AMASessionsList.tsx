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

function AMASessionSkeleton() {
	return (
		<div className="flex h-36 w-[80vw] flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark md:w-52">
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

	const { data: sessions, isLoading } = useAMAs(params.id, searchParams.get('include_ended') === 'true');

	const filtered = useMemo(() => {
		if (!sessions?.length) {
			return [];
		}

		const lower = searchQuery.toLowerCase();
		const matching = sessions.filter((session) => session.title.toLowerCase().includes(lower));
		return sortSessions(matching, sort);
	}, [sessions, searchQuery, sort]);

	if (isLoading) {
		return (
			<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
				<li>
					<CreateAMACard />
				</li>
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
				<li>
					<CreateAMACard />
				</li>
				<li className="md:col-span-2 lg:col-span-3">
					<EmptyState
						icon={<FaComments className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
						subtitle="Create your first AMA session to get started."
						title="No AMA sessions yet"
					/>
				</li>
			</ul>
		);
	}

	if (filtered.length === 0) {
		return (
			<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
				<li>
					<CreateAMACard />
				</li>
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
			<li>
				<CreateAMACard />
			</li>
			{filtered.map((session) => (
				<li key={session.id}>
					<AMASessionCard data={session} />
				</li>
			))}
		</ul>
	);
}
