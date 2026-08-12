'use client';

import { calculateTotalRequiredXp } from '@chatsift/core';
import type { SocialLeaderboardEntry, SocialLeaderboardPage } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { GenericAvatar } from '@/components/common/GenericAvatar';
import { Skeleton } from '@/components/common/Skeleton';
import { cn, roleColor } from '@/utils/util';

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * How far through their current level a member is. Both bounds come from `@chatsift/core`'s curve helpers --
 * the same ones the bot levels people with and `/level` reports progress with -- so this bar can't describe a
 * position the product doesn't actually put them in.
 */
function levelProgress(entry: SocialLeaderboardEntry, curve: NonNullable<SocialLeaderboardPage['curve']>): number {
	const level = entry.level ?? 0;
	const reachedAt = calculateTotalRequiredXp(curve.base, curve.multiplier, level);
	const nextAt = calculateTotalRequiredXp(curve.base, curve.multiplier, level + 1);
	const span = nextAt - reachedAt;

	// A curve with a zero-width step is impossible (both fields are `>= 1` by DB CHECK), but the division is
	// worth guarding anyway rather than rendering a NaN-width bar if that ever stops being true.
	return span <= 0 ? 0 : Math.min(100, Math.max(0, ((entry.xp - reachedAt) / span) * 100));
}

/**
 * The podium gets a nod and nothing more. A leaderboard people actually look at wants some hierarchy at the
 * top, but three differently-coloured medals in a list that scrolls to 500 is noise, not information.
 */
function rankClasses(rank: number): string {
	return rank <= 3
		? 'bg-misc-accent/15 text-misc-accent'
		: 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark';
}

/**
 * The highest reward role the member currently holds -- which one that is, is `@chatsift/core`'s call (see
 * `resolveHighestReward`), resolved to a name and a colour by the API. Wearing the role's own colour rather
 * than a theme token is the point: it's the same marker the server itself shows beside them in Discord.
 */
function RewardBadge({ reward }: { readonly reward: NonNullable<SocialLeaderboardEntry['reward']> }) {
	const color = roleColor(reward.color);

	return (
		<span
			className="inline-flex max-w-36 shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
			// Tinted rather than filled: a role colour is arbitrary, and a solid fill of one would be unreadable
			// against half the palette in one theme or the other.
			style={{ backgroundColor: `${color}1f`, borderColor: `${color}59`, color }}
			title={reward.name}
		>
			<span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
			<span className="min-w-0 truncate">{reward.name}</span>
		</span>
	);
}

interface LeaderboardRowProps {
	readonly curve: SocialLeaderboardPage['curve'];
	readonly entry: SocialLeaderboardEntry;
}

function LeaderboardRow({ curve, entry }: LeaderboardRowProps) {
	return (
		<li className="flex items-center gap-3 border-b border-on-secondary px-4 py-3 last:border-b-0 dark:border-on-secondary-dark">
			<span
				className={cn(
					'flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold tabular-nums',
					rankClasses(entry.rank),
				)}
			>
				{entry.rank}
			</span>

			<GenericAvatar
				assetURL={entry.avatarUrl ?? undefined}
				className="h-9 w-9 shrink-0 rounded-full"
				disableLink
				initials={entry.displayName.slice(0, 2)}
				isLoading={false}
			/>

			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<p className="truncate font-medium text-primary dark:text-primary-dark">{entry.displayName}</p>
					{entry.reward && <RewardBadge reward={entry.reward} />}
				</div>
				{curve && entry.level !== null && (
					<div className="mt-1 flex items-center gap-2">
						<span className="shrink-0 text-xs text-secondary dark:text-secondary-dark">Level {entry.level}</span>
						<span className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-on-tertiary dark:bg-on-tertiary-dark">
							<span
								className="block h-full rounded-full bg-misc-accent"
								style={{ width: `${levelProgress(entry, curve)}%` }}
							/>
						</span>
					</div>
				)}
			</div>

			<span className="shrink-0 text-sm tabular-nums text-secondary dark:text-secondary-dark">
				{numberFormat.format(entry.xp)} XP
			</span>
		</li>
	);
}

interface LeaderboardTableProps {
	readonly curve: SocialLeaderboardPage['curve'];
	readonly entries: readonly SocialLeaderboardEntry[];
	/**
	 * A refetch is in flight over data that's still on screen (paging, or a realtime signal landing). Dims the
	 * list rather than replacing it, since the rows it's about to show are almost always the rows already
	 * there -- swapping in skeletons would make a live leaderboard flicker on every XP grant in the server.
	 */
	readonly isRefreshing?: boolean;
}

export function LeaderboardTable({ curve, entries, isRefreshing = false }: LeaderboardTableProps) {
	return (
		<ol
			className={cn(
				'overflow-hidden rounded-lg border border-on-secondary bg-card transition-opacity dark:border-on-secondary-dark dark:bg-card-dark',
				isRefreshing && 'opacity-60',
			)}
		>
			{entries.map((entry) => (
				<LeaderboardRow curve={curve} entry={entry} key={entry.rank} />
			))}
		</ol>
	);
}

export function LeaderboardTableSkeleton() {
	return (
		<div className="space-y-2">
			<Skeleton className="h-16 w-full rounded-lg" />
			<Skeleton className="h-16 w-full rounded-lg" />
			<Skeleton className="h-16 w-full rounded-lg" />
		</div>
	);
}

interface LeaderboardPagerProps {
	onPageChange(page: number): void;
	readonly page: number;
	readonly pageSize: number;
	readonly total: number;
}

export function LeaderboardPager({ onPageChange, page, pageSize, total }: LeaderboardPagerProps) {
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	if (pageCount === 1) {
		return null;
	}

	const buttonClasses =
		'rounded-md border border-on-secondary px-3 py-1.5 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark';

	return (
		<div className="flex items-center justify-between gap-4">
			<Button className={buttonClasses} isDisabled={page <= 1} onPress={() => onPageChange(page - 1)} type="button">
				Previous
			</Button>
			<span className="text-sm tabular-nums text-secondary dark:text-secondary-dark">
				Page {page} of {pageCount}
			</span>
			<Button
				className={buttonClasses}
				isDisabled={page >= pageCount}
				onPress={() => onPageChange(page + 1)}
				type="button"
			>
				Next
			</Button>
		</div>
	);
}
