'use client';

import { useIsMutating } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from 'react-aria-components';
import { FaInfoCircle, FaSearch, FaServer } from 'react-icons/fa';
import GuildCard from './GuildCard';
import { refreshMeMutationKey, useMe } from '@/api/routes/auth';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { Tooltip } from '@/components/common/Tooltip';
import { resolveGuildAccess } from '@/hooks/useGuildAccess';
import { cn, sortGuilds } from '@/utils/util';

function GuildListSkeleton() {
	return (
		<ul className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
			{Array.from({ length: 4 }).map((_, index) => (
				<li key={index}>
					<Skeleton className="h-[9.5rem] w-full rounded-lg" />
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

	// AMA guests belong here too, not just managers: a guest-only guild always has `meCanManage: false` (see
	// `fetchMe`'s guest-guild synthesis), so filtering on that alone left a guest who manages nothing staring at
	// the "no servers" empty state below -- with no way to reach the AMA they were invited to answer, even
	// though every gate under `/dashboard/[id]/ama` already grants them access. Tiers come from the shared
	// `resolveGuildAccess` rather than a local `meCanManage` read, so this list agrees with what `NavGateCheck`
	// will actually let the viewer do when they click through (global admins included).
	const visible = useMemo(
		() =>
			(me?.guilds ?? [])
				.map((guild) => {
					const { canManage, isAmaGuestOnly } = resolveGuildAccess(me, guild.id);
					return { guild, canManage, isAmaGuestOnly };
				})
				.filter((entry) => entry.canManage || entry.isAmaGuestOnly),
		[me],
	);
	const hasGuestGuilds = useMemo(() => visible.some((entry) => entry.isAmaGuestOnly), [visible]);
	const sorted = useMemo(() => {
		const lower = searchQuery.toLowerCase();

		if (!visible.length) {
			return [];
		}

		const filtered = visible.filter((entry) => entry.guild.name.toLowerCase().includes(lower));
		// Managed servers first, then guest-only ones -- guest access is a much narrower thing (one or two
		// sessions someone added you to) and shouldn't outrank a server you actually run. `sortGuilds` works on
		// bare `MeGuild`s, so the tier flags are re-attached by id afterwards.
		const byId = new Map(filtered.map((entry) => [entry.guild.id, entry]));
		return [
			...sortGuilds(filtered.filter((entry) => entry.canManage).map((entry) => entry.guild)),
			...sortGuilds(filtered.filter((entry) => !entry.canManage).map((entry) => entry.guild)),
		].map((guild) => ({ guild, isAmaGuestOnly: byId.get(guild.id)!.isAmaGuestOnly }));
	}, [visible, searchQuery]);

	// `me` is only `undefined` while the query is still in flight — a resolved-but-logged-out `me` never reaches
	// this component (`NavGateProvider` gates the whole `/dashboard` tree on it), but guarding here too keeps
	// this component correct if it's ever rendered outside that gate.
	if (me === undefined) {
		return <GuildListSkeleton />;
	}

	if (visible.length === 0) {
		return (
			<EmptyState
				icon={<FaServer className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
				subtitle="You need Manage Server permissions on a Discord server to configure it here, or an invite to answer questions in someone's AMA. Just got promoted? Hit Refresh above."
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
		<>
			{me?.sessionKind === 'scoped' && (
				<div className="mb-4 flex items-center gap-1.5 text-sm text-secondary dark:text-secondary-dark">
					<span>Only this server is shown</span>
					<Tooltip content="You may be unable to manage other servers because you signed in via a /dashboard link, which only grants temporary access to the server it was created from.">
						<Button
							aria-label="Why only this server is shown"
							className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary dark:focus-visible:ring-primary-dark"
							type="button"
						>
							<FaInfoCircle className="h-3.5 w-3.5" />
						</Button>
					</Tooltip>
				</div>
			)}
			{hasGuestGuilds && (
				<p className="mb-4 text-sm text-secondary dark:text-secondary-dark">
					Servers marked <span className="font-medium text-primary dark:text-primary-dark">Guest</span> are ones you
					were invited to answer an AMA in — you&apos;ll only see those sessions there, nothing else.
				</p>
			)}
			<ul
				className={cn(
					'grid grid-cols-1 gap-4 transition-opacity md:grid-cols-3 lg:grid-cols-4',
					isRefreshing && 'opacity-50',
				)}
			>
				{sorted.map(({ guild, isAmaGuestOnly }) => (
					<li className="min-w-0" key={guild.id}>
						<GuildCard data={guild} isGuest={isAmaGuestOnly} />
					</li>
				))}
			</ul>
		</>
	);
}
