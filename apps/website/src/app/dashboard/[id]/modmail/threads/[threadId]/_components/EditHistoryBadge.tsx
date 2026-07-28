'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { useModmailMessageEdits } from '@/api/routes/modmailThreads';
import { Skeleton } from '@/components/common/Skeleton';
import { formatDate } from '@/utils/util';

interface EditHistoryBadgeProps {
	readonly messageId: number;
}

/**
 * The "(edited)" badge + popover for a recorded message's prior versions (Phase 3 must, #261). Fetches
 * lazily -- `useModmailMessageEdits`'s `enabled` only flips on once the popover is actually opened, so a
 * long thread full of edited messages doesn't fetch every history nobody looks at.
 */
export function EditHistoryBadge({ messageId }: EditHistoryBadgeProps) {
	const { id: guildId, threadId } = useParams<{ id: string; threadId: string }>();
	const [isOpen, setIsOpen] = useState(false);
	const { data, error, isLoading, refetch } = useModmailMessageEdits(guildId, threadId, messageId, isOpen);

	return (
		<DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button className="text-xs text-secondary hover:underline dark:text-secondary-dark" type="button">
				(edited)
			</Button>
			<Popover className="w-80 rounded-md border border-on-secondary bg-card p-3 shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
				<Dialog className="outline-none">
					<p className="mb-2 text-xs font-medium text-secondary dark:text-secondary-dark">
						Edit history (newest first)
					</p>
					{isLoading && (
						<div className="flex flex-col gap-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					)}
					{!isLoading && error && (
						<div className="flex flex-col items-start gap-2">
							<p className="text-sm text-red-600 dark:text-red-400">Failed to load edit history.</p>
							<Button
								className="text-xs text-secondary hover:underline dark:text-secondary-dark"
								onPress={() => void refetch()}
								type="button"
							>
								Retry
							</Button>
						</div>
					)}
					{!isLoading && !error && data?.edits.length === 0 && (
						<p className="text-sm text-secondary dark:text-secondary-dark">No prior versions recorded.</p>
					)}
					{!isLoading && !error && data && data.edits.length > 0 && (
						<div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
							{data.edits.map((edit, index) => (
								<div
									className="rounded border border-on-secondary p-2 dark:border-on-secondary-dark"
									key={`${edit.editedAt}-${index}`}
								>
									<p className="mb-1 text-xs text-secondary dark:text-secondary-dark">
										{formatDate(new Date(edit.editedAt))}
									</p>
									<p className="whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">{edit.oldContent}</p>
								</div>
							))}
						</div>
					)}
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}
