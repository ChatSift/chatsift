'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useDebounceValue } from 'usehooks-ts';
import { AuthorAvatar } from './AuthorAvatar';
import { MERGEABLE_STATES } from './mergeableStates';
import { userLabel } from './userLabel';
import { useAMAQuestions, useMergeAMAQuestionsBulk } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';

const DEBOUNCE_TIME = 300;
const RECENT_QUESTIONS_LIMIT = 5;

interface BulkMergePickerProps {
	onClose(): void;
	onMerged(): void;
	readonly questionIds: number[];
}

/**
 * Bulk counterpart to `MergeDuplicatePicker.tsx` (#293 follow-up, requested after the fact) -- same
 * search-as-you-type flow, but merges every selected question from the list into one chosen original in
 * a single request instead of repeating the single-question flow per duplicate.
 */
export function BulkMergePicker({ questionIds, onClose, onMerged }: BulkMergePickerProps) {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const [query, setQuery] = useState('');
	const [debouncedQuery, setDebouncedQuery] = useDebounceValue('', DEBOUNCE_TIME);
	const mergeQuestionsBulk = useMergeAMAQuestionsBulk(guildId, amaId);

	const isSearching = debouncedQuery.trim().length > 0;
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useAMAQuestions(guildId, amaId, {
		q: debouncedQuery || undefined,
	});
	// A question already selected as one of the duplicates being merged away can't also be the target --
	// and the target itself has to still be in the active pipeline (mirrors the API's own validation in
	// `mergeQuestionsBulk.ts`), so a DENIED/FLAGGED/ASKED question shouldn't be offered as a pick here.
	const allMatches = (data?.pages.flatMap((page) => page.questions) ?? []).filter(
		(q) => !questionIds.includes(q.id) && MERGEABLE_STATES.has(q.state),
	);
	// With no search typed yet, default to the most recent few questions (already in memory, already
	// most-recent-first via `listQuestions.ts`'s keyset order) instead of making the user search before
	// seeing anything at all.
	const matches = isSearching ? allMatches : allMatches.slice(0, RECENT_QUESTIONS_LIMIT);

	const handleMerge = async (intoQuestionId: number) => {
		await mergeQuestionsBulk.mutateAsync({ intoQuestionId, questionIds });
		onMerged();
	};

	return (
		<div className="rounded-md border border-misc-accent bg-card p-3 dark:bg-card-dark">
			<div className="mb-2 flex items-center justify-between">
				<p className="text-sm font-medium text-primary dark:text-primary-dark">
					Merge {questionIds.length} selected question{questionIds.length === 1 ? '' : 's'} into -- search for the
					original
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
								isDisabled={mergeQuestionsBulk.isPending}
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
