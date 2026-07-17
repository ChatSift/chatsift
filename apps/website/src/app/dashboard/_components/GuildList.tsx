'use client';

import { useIsMutating } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { FaSearch, FaServer } from 'react-icons/fa';
import GuildCard from './GuildCard';
import { refreshMeMutationKey, useMe } from '@/api/routes/auth';
import { cn, sortGuilds } from '@/utils/util';

function EmptyState({ icon, subtitle, title }: { readonly icon: ReactNode; readonly subtitle: string; readonly title: string }) {
	return (
		<div className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-on-secondary bg-card p-8 text-center dark:border-on-secondary-dark dark:bg-card-dark">
			{icon}
			<p className="text-lg font-medium text-primary dark:text-primary-dark">{title}</p>
			<p className="text-sm text-secondary dark:text-secondary-dark">{subtitle}</p>
		</div>
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
			className={cn('grid grid-cols-1 gap-4 transition-opacity md:grid-cols-3 lg:grid-cols-4', isRefreshing && 'opacity-50')}
		>
			{sorted.map((guild) => (
				<li key={guild.id}>
					<GuildCard data={guild} />
				</li>
			))}
		</ul>
	);
}
