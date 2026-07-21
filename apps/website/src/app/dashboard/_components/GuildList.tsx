'use client';

import { useIsMutating } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { FaSearch, FaServer } from 'react-icons/fa';
import GuildCard from './GuildCard';
import { refreshMeMutationKey, useMe } from '@/api/routes/auth';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { cn, sortGuilds } from '@/utils/util';

function GuildListSkeleton() {
	return (
		<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
			{Array.from({ length: 4 }).map((_, index) => (
				<li key={index}>
					<Skeleton className="h-36 w-full rounded-lg" />
				</li>
			))}
		</ul>
	);
}

export function GuildList() {
	const { data: me } = useMe();
	const searchParams = useSearchParams();
	const isRefreshing = useIsMutating({ mutationKey: refreshMeMutationKey }) > 0;

	const searchQuery = searchParams.get('search') ?? '';

	const manageable = useMemo(() => me?.guilds.filter((g) => g.meCanManage) ?? [], [me]);
	const sorted = useMemo(() => {
		const lower = searchQuery.toLowerCase();

		if (!manageable.length) {
			return [];
		}

		const filtered = manageable.filter((guild) => guild.name.toLowerCase().includes(lower));
		return sortGuilds(filtered);
	}, [manageable, searchQuery]);

	// `me` is only `undefined` while the query is still in flight — a resolved-but-logged-out `me` never reaches
	// this component (`NavGateProvider` gates the whole `/dashboard` tree on it), but guarding here too keeps
	// this component correct if it's ever rendered outside that gate.
	if (me === undefined) {
		return <GuildListSkeleton />;
	}

	if (manageable.length === 0) {
		return (
			<EmptyState
				icon={<FaServer className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
				subtitle="You need Manage Server permissions on a Discord server to configure it here. Just got promoted? Hit Refresh above."
				title="No servers to manage yet"
			/>
		);
	}

	if (sorted.length === 0) {
		return (
			<EmptyState
				icon={<FaSearch className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
				subtitle={`No servers match "${searchQuery}".`}
				title="No results"
			/>
		);
	}

	return (
		<ul
			className={cn(
				'grid grid-cols-1 gap-4 transition-opacity md:grid-cols-3 lg:grid-cols-4',
				isRefreshing && 'opacity-50',
			)}
		>
			{sorted.map((guild) => (
				<li key={guild.id}>
					<GuildCard data={guild} />
				</li>
			))}
		</ul>
	);
}
