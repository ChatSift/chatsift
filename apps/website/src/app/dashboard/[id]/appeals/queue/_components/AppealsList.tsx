'use client';

import { appealsQueueChannel } from '@chatsift/core';
import { Button } from '@chatsift/web-core/components/Button';
import { DiscordUserAvatar } from '@chatsift/web-core/components/DiscordUserAvatar';
import { EmptyState } from '@chatsift/web-core/components/EmptyState';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { cn } from '@chatsift/web-core/utils/cn';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useStatusFilter } from './AppealFilters';
import { statusLabel, STATUS_PILL_CLASSES } from './appealDisplay';
import { queryKeys } from '@/api/queryClient';
import type { AppealListItem } from '@/api/routes/appeals';
import { useAppeals } from '@/api/routes/appeals';
import { snapshotUserLabel } from '@/components/dashboard/userDisplay';
import { SvgAppeals } from '@/components/icons/SvgAppeals';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { formatDate } from '@/utils/util';

/**
 * The ban the appeal is about, as Discord recorded it when they filed. It is the one line that tells a
 * moderator whether this appeal is worth opening, which is why it is the preview rather than an answer: the
 * questionnaire is the appellant's case for themselves and every one of them reads the same at a glance.
 */
function previewLine(appeal: AppealListItem): string {
	const reason = appeal.reasonSnapshot?.trim();
	return reason?.length ? reason : 'Discord had no reason recorded for the ban';
}

function metaLine(appeal: AppealListItem): string {
	const filed = `Filed ${formatDate(new Date(appeal.createdAt))}`;
	if (!appeal.decidedAt) {
		return filed;
	}

	// Not "decided by" when nobody decided it: a withdrawal is the appellant's own act and a `MOOT` close is the
	// system noticing the ban was lifted elsewhere, and both carry a null actor by construction (P4b).
	const who = appeal.decidedByUser ? ` by ${snapshotUserLabel(appeal.decidedByUser, null)}` : '';
	return `${filed} · closed ${formatDate(new Date(appeal.decidedAt))}${who}`;
}

function AppealRow({ guildId, appeal }: { readonly appeal: AppealListItem; readonly guildId: string }) {
	const label = snapshotUserLabel(appeal.appellant, null);

	return (
		<Link
			className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark sm:flex-row sm:items-center sm:justify-between"
			href={`/dashboard/${guildId}/appeals/queue/${appeal.id}`}
		>
			<div className="flex min-w-0 items-center gap-3">
				<DiscordUserAvatar
					className="h-10 w-10 shrink-0 rounded-full"
					initials={label.slice(0, 2)}
					user={appeal.appellant}
				/>
				<div className="flex min-w-0 flex-col overflow-hidden">
					{/* Numbered like a case row, because the number is what the detail page, the Discord card's footer
					    and any conversation about this appeal all use to name it. */}
					<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">
						<span className="text-secondary dark:text-secondary-dark">#{appeal.id}</span> {label}
					</p>
					<p className="truncate text-sm text-secondary dark:text-secondary-dark">{previewLine(appeal)}</p>
					<p className="text-sm text-secondary dark:text-secondary-dark">{metaLine(appeal)}</p>
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<span
					className={cn(
						'rounded-full px-2.5 py-1 text-xs font-medium',
						STATUS_PILL_CLASSES[appeal.status] ?? 'bg-on-tertiary text-secondary',
					)}
				>
					{statusLabel(appeal)}
				</span>
			</div>
		</Link>
	);
}

export function AppealsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();

	// Appeals originate on `unban.app` and are decided from two places, so this subscription is the only thing
	// that keeps an open queue current: both the submit path and every decision publish here.
	useRealtimeInvalidate(appealsQueueChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.queue.all(guildId) });
	});

	// Raw id rather than free text, for the reason `CasesList` documents: an appellant is banned from this guild
	// by definition, so there is no member list to search and nothing stores a username snapshot.
	// Empty-or-whitespace must collapse to `undefined` rather than `''` -- an empty `user_id=` fails the API's
	// snowflake schema and would key a separate cache entry from "no filter".
	const search = searchParams.get('search')?.trim();
	const userId = search?.length ? search : undefined;
	const status = useStatusFilter();

	const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAppeals(guildId, {
		status,
		userId,
	});

	const appeals = data?.pages.flatMap((page) => page.appeals) ?? [];
	// Off the first page rather than the last: every page carries the same guild-wide count, and the first one is
	// the page that exists before anybody scrolls.
	const pendingCount = data?.pages[0]?.pendingCount ?? 0;

	if (error && appeals.length === 0) {
		return <UserErrorHandler error={error} />;
	}

	return (
		<div className="flex flex-col gap-4">
			{!isLoading && pendingCount > 0 && (
				// Guild-wide and filter-independent, so it still reads correctly on a page filtered to `Approved`.
				<p className="text-sm text-secondary dark:text-secondary-dark">
					{pendingCount === 1 ? '1 appeal is' : `${pendingCount} appeals are`} waiting on a decision.
				</p>
			)}

			{isLoading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-24 w-full rounded-lg" />
					<Skeleton className="h-24 w-full rounded-lg" />
					<Skeleton className="h-24 w-full rounded-lg" />
				</div>
			) : appeals.length === 0 ? (
				<EmptyState
					icon={<SvgAppeals height={28} width={28} />}
					subtitle={
						userId || status
							? 'No appeals match these filters.'
							: 'Appeals filed on unban.app show up here and in your mod channel. Nobody can file one until a mod channel is set in Config.'
					}
					title="No appeals yet"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{appeals.map((appeal) => (
						<AppealRow appeal={appeal} guildId={guildId} key={appeal.id} />
					))}
				</div>
			)}

			{hasNextPage && (
				<Button
					className="w-fit border border-on-secondary dark:border-on-secondary-dark"
					isDisabled={isFetchingNextPage}
					onPress={() => fetchNextPage()}
				>
					{isFetchingNextPage ? 'Loading...' : 'Load more'}
				</Button>
			)}
		</div>
	);
}
