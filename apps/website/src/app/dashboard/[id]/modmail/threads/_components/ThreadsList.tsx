'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import type { ModmailThreadListItem } from '@/api/routes/modmailThreads';
import { useModmailThreads } from '@/api/routes/modmailThreads';
import { Button } from '@/components/common/Button';
import { Emoji } from '@/components/common/Emoji';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { formatDate } from '@/utils/util';

function threadUserLabel(user: ModmailThreadListItem['user']): string {
	if (typeof user === 'string') {
		return user;
	}

	return user.global_name ?? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`;
}

function ThreadRow({ guildId, thread }: { readonly guildId: string; readonly thread: ModmailThreadListItem }) {
	const isClosed = thread.closedAt !== null;

	return (
		<Link
			className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark sm:flex-row sm:items-center sm:justify-between"
			href={`/dashboard/${guildId}/modmail/threads/${thread.id}`}
		>
			<div className="flex flex-col overflow-hidden">
				<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
					{threadUserLabel(thread.user)}
				</p>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Opened {formatDate(new Date(thread.createdAt))}
				</p>
			</div>

			<div className="flex shrink-0 items-center gap-2">
				{thread.category && (
					<span className="flex items-center gap-1 rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary dark:bg-on-tertiary-dark dark:text-primary-dark">
						{thread.category.emoji && <Emoji className="h-3 w-3" value={thread.category.emoji} />}
						{thread.category.name}
					</span>
				)}
				<span
					className={
						isClosed
							? 'rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark'
							: 'rounded-full bg-misc-accent/10 px-2.5 py-1 text-xs font-medium text-misc-accent'
					}
				>
					{isClosed ? 'Closed' : 'Open'}
				</span>
			</div>
		</Link>
	);
}

export function ThreadsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const searchParams = useSearchParams();

	const search = searchParams.get('search') ?? '';
	const includeClosed = searchParams.get('include_closed') === 'true';

	const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useModmailThreads(
		guildId,
		includeClosed,
		search,
	);

	const threads = data?.pages.flatMap((page) => page.threads) ?? [];

	if (error && threads.length === 0) {
		return <UserErrorHandler error={error} />;
	}

	return (
		<div className="flex flex-col gap-4">
			{isLoading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
				</div>
			) : threads.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					{search ? `No threads match "${search}".` : 'No threads yet.'}
				</p>
			) : (
				<div className="flex flex-col gap-3">
					{threads.map((thread) => (
						<ThreadRow guildId={guildId} key={thread.id} thread={thread} />
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
