'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useDebounceValue } from 'usehooks-ts';
import { AuthorAvatar } from './AuthorAvatar';
import { userLabel } from './userLabel';
import { useAMAQuestions, useMergeAMAQuestion } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';

const DEBOUNCE_TIME = 300;
const RECENT_QUESTIONS_LIMIT = 5;

interface MergeDuplicatePickerProps {
	onClose(): void;
	onMerged(): void;
	onMergingChange?(isMerging: boolean): void;
	readonly questionId: number;
}

/**
 * "Mark as duplicate" flow (#293 follow-up, owner's spec): search for the original, pick it, this
 * question gets merged into it and deleted. Search-as-you-type against the same paginated
 * `listQuestions` route the main list uses, scoped to this AMA and excluding the question being
 * merged away.
 */
export function MergeDuplicatePicker({ questionId, onClose, onMerged, onMergingChange }: MergeDuplicatePickerProps) {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useDebounceValue('', DEBOUNCE_TIME);
	const mergeQuestion = useMergeAMAQuestion(guildId, amaId, questionId);

	const isSearching = debouncedQuery.trim().length > 0;
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useAMAQuestions(guildId, amaId, {
		q: debouncedQuery || undefined,
	});
	const allMatches = (data?.pages.flatMap((page) => page.questions) ?? []).filter((q) => q.id !== questionId);
	// With no search typed yet, default to the most recent few questions (already in memory, already
	// most-recent-first via `listQuestions.ts`'s keyset order) instead of making the user search before
	// seeing anything at all.
	const matches = isSearching ? allMatches : allMatches.slice(0, RECENT_QUESTIONS_LIMIT);

	const handleMerge = async (intoQuestionId: number) => {
		// Stops the parent's own `useAMAQuestion(questionId)` from refetching (and 404ing) once this
		// question is deleted -- disabled the instant the merge starts, well before the mutation's own
		// cache invalidation can race an active query against the now-gone id.
		onMergingChange?.(true);
		try {
			await mergeQuestion.mutateAsync({ intoQuestionId });
			onMerged();
		} catch (error) {
			onMergingChange?.(false);
			throw error;
		}
	};

	return (
		<div className="rounded-md border border-on-secondary bg-card p-3 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="mb-2 flex items-center justify-between">
				<p className="text-sm font-medium text-primary dark:text-primary-dark">
					Mark as duplicate - search for the original question
				</p>
				<Button className="h-7 px-2 text-xs" onPress={onClose} type="button">
					Cancel
				</Button>
			</div>
			<input
				aria-label="Search question content"
				autoFocus
				className="mb-2 w-full rounded-md border border-on-secondary bg-card px-2 py-1.5 text-sm text-primary focus:border-misc-accent focus:outline-none dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
				onChange={(e) => {
					setQuery(e.target.value);
					setDebouncedQuery(e.target.value);
				}}
				placeholder="Search question content..."
				type="text"
				value={query}
			/>
			{!isSearching && matches.length > 0 && (
				<p className="mb-1 text-xs text-secondary dark:text-secondary-dark">Recent questions</p>
			)}
			<div className="max-h-56 space-y-1 overflow-y-auto">
				{matches.length === 0 ? (
					<p className="text-sm text-secondary dark:text-secondary-dark">
						{isSearching ? 'No matches.' : 'No other questions yet.'}
					</p>
				) : (
					matches.map((match) => (
						<div
							className="flex items-center justify-between gap-2 rounded-md border border-on-secondary p-2 dark:border-on-secondary-dark"
							key={match.id}
						>
							<div className="min-w-0">
								<p className="truncate text-sm text-primary dark:text-primary-dark" title={match.content}>
									#{match.id} - {match.content}
								</p>
								<div className="mt-1 flex items-center gap-1.5">
									<AuthorAvatar className="h-4 w-4 rounded-full" user={match.author} />
									<p className="text-xs text-secondary dark:text-secondary-dark">{userLabel(match.author)}</p>
								</div>
							</div>
							<Button
								className="h-7 shrink-0 border border-on-secondary px-2 text-xs dark:border-on-secondary-dark"
								isDisabled={mergeQuestion.isPending}
								onPress={async () => handleMerge(match.id)}
								type="button"
							>
								Merge into this
							</Button>
						</div>
					))
				)}
				{isSearching && hasNextPage && (
					<Button
						className="w-full border border-on-secondary text-xs dark:border-on-secondary-dark"
						isDisabled={isFetchingNextPage}
						onPress={() => fetchNextPage()}
						type="button"
					>
						{isFetchingNextPage ? 'Loading...' : 'Load more'}
					</Button>
				)}
			</div>
		</div>
	);
}
