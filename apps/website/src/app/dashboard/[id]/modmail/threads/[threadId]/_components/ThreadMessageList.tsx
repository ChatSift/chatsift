'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { InternalChatterGroup } from './InternalChatterGroup';
import { ThreadMessage } from './ThreadMessage';
import { buildRenderItems } from './threadMessageUtils';
import type { ModmailThreadMessage } from '@/api/routes/modmailThreads';
import { Button } from '@/components/common/Button';

interface ThreadMessageListProps {
	fetchNextPage(): void;
	fetchPreviousPage(): Promise<unknown>;
	readonly hasNextPage: boolean;
	readonly hasPreviousPage: boolean;
	readonly isFetchingNextPage: boolean;
	readonly isFetchingPreviousPage: boolean;
	readonly messages: ModmailThreadMessage[];
	readonly participants: Record<string, APIUser | Snowflake>;
}

/**
 * Virtualized (Phase 3, #261) -- a thread can grow to thousands of messages (the whole reason recording is
 * opt-in, see docs/roadmap/07-modmail-thread-history.md), so only the messages actually near the viewport
 * stay mounted. `estimateSize` is just a starting guess; `measureElement` corrects it per-item once
 * rendered (messages vary a lot in height -- images, stickers, internal-chatter groups).
 */
export function ThreadMessageList({
	messages,
	participants,
	fetchNextPage,
	fetchPreviousPage,
	hasNextPage,
	hasPreviousPage,
	isFetchingNextPage,
	isFetchingPreviousPage,
}: ThreadMessageListProps) {
	const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message] as const)), [messages]);
	const renderItems = useMemo(() => buildRenderItems(messages), [messages]);

	const parentRef = useRef<HTMLDivElement>(null);

	const virtualizer = useVirtualizer({
		count: renderItems.length,
		estimateSize: () => 96,
		getScrollElement: () => parentRef.current,
		overscan: 8,
	});

	// Preserve the visual scroll position when older messages prepend above the viewport -- `fetchPreviousPage`
	// grows the list at the *start*, which would otherwise yank the viewport up to the newly-inserted content.
	// Captures `scrollHeight` right before the fetch resolves and restores the same offset once the DOM has
	// grown to match (same delta-based technique any "load older" chat/feed UI needs, since the virtualizer
	// itself has no notion of "this batch was prepended, not appended").
	const pendingScrollRestoreRef = useRef<number | null>(null);

	const handleFetchPreviousPage = async () => {
		if (parentRef.current) {
			pendingScrollRestoreRef.current = parentRef.current.scrollHeight;
		}

		try {
			await fetchPreviousPage();
		} catch {
			// A failed fetch never grows `messages`, so the scroll-restore effect's own `[messages]` dependency
			// would never fire to consume this -- left set, it would incorrectly apply to whatever *next*
			// unrelated messages update happens to land.
			pendingScrollRestoreRef.current = null;
		}
	};

	useLayoutEffect(() => {
		const parent = parentRef.current;
		const previousScrollHeight = pendingScrollRestoreRef.current;
		if (previousScrollHeight === null || !parent) {
			return;
		}

		pendingScrollRestoreRef.current = null;
		parent.scrollTop += parent.scrollHeight - previousScrollHeight;
		// Re-runs whenever the message list actually grows/shrinks (a new page landing), which is the only
		// time `pendingScrollRestoreRef` can be non-null in the first place.
	}, [messages]);

	const handleJumpToMessage = (messageId: number) => {
		const index = renderItems.findIndex((item) =>
			item.type === 'message' ? item.message.id === messageId : item.messages.some((m) => m.id === messageId),
		);
		if (index >= 0) {
			virtualizer.scrollToIndex(index, { align: 'center' });
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{messages.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">No messages in this thread yet.</p>
			) : (
				<>
					{hasPreviousPage && (
						<Button
							className="w-fit self-center border border-on-secondary text-xs dark:border-on-secondary-dark"
							isDisabled={isFetchingPreviousPage}
							onPress={async () => handleFetchPreviousPage()}
						>
							{isFetchingPreviousPage ? 'Loading...' : 'Load older messages'}
						</Button>
					)}

					<div className="h-[70vh] overflow-y-auto" ref={parentRef}>
						<div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
							{virtualizer.getVirtualItems().map((virtualItem) => {
								const item = renderItems[virtualItem.index]!;
								const key = item.type === 'message' ? item.message.id : `group-${item.messages[0]!.id}`;
								// Spacing is attached to the *start* of a row rather than the end of the one before it --
								// a row that continues the same author's block (`showHeader: false`) sits tight against
								// whatever came before it, while a row that starts a new block (a new author, or an
								// internal-chatter group, which is always its own block) gets the full gap. Keying off
								// bottom-padding instead (the original approach) put the gap on the *wrong* row when a
								// grouped continuation happened to be followed by a new block, and left a trailing gap
								// after the very last row for no reason. The very first row never gets top padding at
								// all -- the container's own `p-4` already provides that space, and stacking both
								// looked like a too-large gap above the first message.
								const isNewBlock = item.type !== 'message' || item.showHeader;
								const topPaddingClassName = virtualItem.index === 0 ? '' : isNewBlock ? 'pt-4' : 'pt-0.5';

								return (
									<div
										data-index={virtualItem.index}
										key={key}
										ref={virtualizer.measureElement}
										style={{
											left: 0,
											position: 'absolute',
											top: 0,
											transform: `translateY(${virtualItem.start}px)`,
											width: '100%',
										}}
									>
										<div className={topPaddingClassName}>
											{item.type === 'message' ? (
												<ThreadMessage
													message={item.message}
													messagesById={messagesById}
													onJumpToMessage={handleJumpToMessage}
													participants={participants}
													showHeader={item.showHeader}
												/>
											) : (
												<InternalChatterGroup
													messages={item.messages}
													messagesById={messagesById}
													participants={participants}
												/>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>

					{hasNextPage && (
						<Button
							className="w-fit self-center border border-on-secondary dark:border-on-secondary-dark"
							isDisabled={isFetchingNextPage}
							onPress={() => fetchNextPage()}
						>
							{isFetchingNextPage ? 'Loading...' : 'Load more'}
						</Button>
					)}
				</>
			)}
		</div>
	);
}
