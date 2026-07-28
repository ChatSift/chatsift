'use client';

import { useParams } from 'next/navigation';
import { ThreadMessageList } from './ThreadMessageList';
import { ThreadSidebar } from './ThreadSidebar';
import { useModmailThread } from '@/api/routes/modmailThreads';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function ThreadDetail() {
	const { id: guildId, threadId } = useParams<{ id: string; threadId: string }>();
	const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useModmailThread(
		guildId,
		threadId,
	);

	if (error && data === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data) {
		return (
			<div className="flex flex-col gap-6">
				<Skeleton className="h-8 w-48" />
				<div className="flex flex-col gap-6 lg:flex-row">
					<Skeleton className="h-64 w-full rounded-lg lg:w-80 lg:shrink-0" />
					<Skeleton className="h-64 w-full flex-1 rounded-lg" />
				</div>
			</div>
		);
	}

	// Sidebar fields (category/member/tags/thread history) are identical across every page for this thread --
	// only `messages`/`nextCursor` change page to page -- so the first fetched page is as good a source for them
	// as any and avoids re-deriving from whichever page happened to load last.
	const firstPage = data.pages[0]!;
	const messages = data.pages.flatMap((page) => page.messages);
	const participants = Object.assign({}, ...data.pages.map((page) => page.participants));

	return (
		<div className="flex flex-col gap-6">
			<Heading subtitle={firstPage.category?.name ?? 'No category'} title={`Thread #${firstPage.id}`} />

			<div className="flex flex-col gap-6 lg:flex-row">
				<div className="lg:w-80 lg:shrink-0">
					<ThreadSidebar guildId={guildId} thread={firstPage} />
				</div>
				<div className="min-w-0 flex-1">
					<ThreadMessageList
						fetchNextPage={fetchNextPage}
						hasNextPage={hasNextPage}
						isFetchingNextPage={isFetchingNextPage}
						messages={messages}
						participants={participants}
					/>
				</div>
			</div>
		</div>
	);
}
