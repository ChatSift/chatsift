'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { ThreadMessage } from './ThreadMessage';
import type { ModmailThreadMessage } from '@/api/routes/modmailThreads';
import { Button } from '@/components/common/Button';

interface ThreadMessageListProps {
	fetchNextPage(): void;
	readonly hasNextPage: boolean;
	readonly isFetchingNextPage: boolean;
	readonly messages: ModmailThreadMessage[];
	readonly participants: Record<string, APIUser | Snowflake>;
}

export function ThreadMessageList({
	messages,
	participants,
	fetchNextPage,
	hasNextPage,
	isFetchingNextPage,
}: ThreadMessageListProps) {
	const messagesById = new Map(messages.map((message) => [message.id, message] as const));

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{messages.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">No messages in this thread yet.</p>
			) : (
				<div className="flex flex-col gap-4">
					{messages.map((message) => (
						<ThreadMessage key={message.id} message={message} messagesById={messagesById} participants={participants} />
					))}
				</div>
			)}

			{hasNextPage && (
				<Button
					className="w-fit self-center border border-on-secondary dark:border-on-secondary-dark"
					isDisabled={isFetchingNextPage}
					onPress={() => fetchNextPage()}
				>
					{isFetchingNextPage ? 'Loading...' : 'Load more'}
				</Button>
			)}
		</div>
	);
}
