'use client';

import { amaQuestionsChannel, MERGE_SOURCE_STATES } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthorAvatar } from './AuthorAvatar';
import { BulkMergePicker } from './BulkMergePicker';
import { QuestionDetailPanel } from './QuestionDetailPanel';
import { useQuestionStateFilter } from './QuestionStateTabs';
import { useTagFilter } from './QuestionTagFilter';
import { DEFAULT_STATE_CHIP_CLASS, STATE_CHIP_CLASSES, STATE_LABELS } from './questionState';
import { userLabel } from './userLabel';
import type { AMAQuestionListItem } from '@/api/routes/ama';
import { invalidateAMAQuestions, useAMAQuestions } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { useURLParam } from '@/hooks/useURLParam';

const ROW_PREVIEW_LENGTH = 160;

// `line-clamp-2` alone doesn't make it visually obvious whether a 2-line-long question got cut off or
// happened to end exactly there -- an explicit ellipsis at a fixed character count removes the ambiguity.
function previewContent(content: string): string {
	return content.length > ROW_PREVIEW_LENGTH ? `${content.slice(0, ROW_PREVIEW_LENGTH).trimEnd()}…` : content;
}

function useAuthorFilter(): string | undefined {
	const [authorParam] = useURLParam('author');
	return authorParam ?? undefined;
}

interface QuestionRowProps {
	readonly isExpanded: boolean;
	readonly isSelected: boolean;
	onToggle(): void;
	onToggleSelect(): void;
	readonly question: AMAQuestionListItem;
	readonly selectMode: boolean;
}

function QuestionRow({ isExpanded, isSelected, onToggle, onToggleSelect, question, selectMode }: QuestionRowProps) {
	const [, setAuthorParam] = useURLParam('author');
	const [, setTagParam] = useURLParam('tag');
	const [, setTabParam] = useURLParam('tab');

	const stateToTab: Record<string, string> = {
		PENDING_REVIEW: 'pending',
		APPROVED: 'guest-questions',
		ASKED: 'asked',
		DENIED: 'denied',
	};

	const canSelect = MERGE_SOURCE_STATES.has(question.state);

	return (
		<div className="rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 flex-1 items-start gap-3">
					{selectMode && (
						<input
							aria-label={`Select question #${question.id} for merging`}
							checked={isSelected}
							className="mt-1.5 h-4 w-4 shrink-0 rounded border-on-secondary disabled:opacity-30 dark:border-on-secondary-dark"
							disabled={!canSelect}
							onChange={onToggleSelect}
							title={canSelect ? undefined : `Questions in state ${question.state} can't be merged`}
							type="checkbox"
						/>
					)}
					{/* A `Button` nested inside another interactive element isn't valid HTML (and would break the
					chips' own click handling below) -- this is a sibling of the chips row, not a wrapper around
					it, so expanding the row and clicking a chip stay independent gestures. */}
					<Button
						className="min-w-0 flex-1 items-start justify-start px-0 py-0 text-left hover:bg-transparent dark:hover:bg-transparent"
						onPress={onToggle}
					>
						<p
							className="w-full min-w-0 whitespace-normal wrap-break-word text-lg font-medium text-primary dark:text-primary-dark"
							title={question.content}
						>
							#{question.id} - {previewContent(question.content)}
						</p>
					</Button>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2">
					<Button
						className="h-auto gap-1.5 rounded-full bg-transparent px-0 py-0 text-sm text-secondary hover:bg-transparent hover:text-misc-accent dark:text-secondary-dark dark:hover:bg-transparent"
						onPress={() => setAuthorParam(question.authorId)}
					>
						<AuthorAvatar className="h-5 w-5 rounded-full" user={question.author} />
						{userLabel(question.author)}
						{question.extraAskerCount > 0 && ` (+${question.extraAskerCount})`}
					</Button>
					{question.tags.map((tag) => (
						<Button
							className="h-auto rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary hover:bg-misc-accent/10 hover:text-misc-accent dark:bg-on-tertiary-dark dark:text-primary-dark"
							key={tag.id}
							onPress={() => setTagParam(String(tag.id))}
						>
							{tag.name}
						</Button>
					))}
					<Button
						className={`h-auto rounded-full px-2.5 py-1 text-xs font-medium hover:opacity-80 ${STATE_CHIP_CLASSES[question.state] ?? DEFAULT_STATE_CHIP_CLASS}`}
						onPress={() => setTabParam(stateToTab[question.state] ?? null)}
					>
						{STATE_LABELS[question.state] ?? question.state}
					</Button>
				</div>
			</div>

			{isExpanded && (
				<div className="mt-4">
					<QuestionDetailPanel onMerged={onToggle} questionId={question.id} />
				</div>
			)}
		</div>
	);
}

export function QuestionsList() {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const queryClient = useQueryClient();
	useRealtimeInvalidate(amaQuestionsChannel(guildId, amaId), () => {
		void invalidateAMAQuestions(queryClient, guildId, amaId);
	});

	const searchParams = useSearchParams();
	const search = searchParams.get('search') ?? '';
	const states = useQuestionStateFilter();
	const tagId = useTagFilter();
	const authorId = useAuthorFilter();
	const [, setAuthorParam] = useURLParam('author');
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [selectMode, setSelectMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState<number[]>([]);
	const [showBulkMerge, setShowBulkMerge] = useState(false);

	const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAMAQuestions(guildId, amaId, {
		states,
		tagId,
		authorId,
		q: search,
	});

	const questions = data?.pages.flatMap((page) => page.questions) ?? [];

	const exitSelectMode = () => {
		setSelectMode(false);
		setSelectedIds([]);
		setShowBulkMerge(false);
	};

	// A selection is only ever meaningful against the result set it was made from -- switching states/tag/
	// author/search out from under it would let a bulk merge silently include questions the user never
	// actually looked at (or can no longer even see in the list) once the filters change.
	useEffect(() => {
		exitSelectMode();
	}, [states, tagId, authorId, search]);

	const toggleSelected = (questionId: number) => {
		setSelectedIds((prev) =>
			prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId],
		);
	};

	if (error && questions.length === 0) {
		return <UserErrorHandler error={error} />;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Button
					className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
					onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
					type="button"
				>
					{selectMode ? 'Cancel Selection' : 'Select Duplicates'}
				</Button>
				{selectMode && selectedIds.length > 0 && (
					<>
						<span className="text-sm text-secondary dark:text-secondary-dark">{selectedIds.length} selected</span>
						<Button
							className="h-9 bg-misc-accent px-3 text-sm text-white hover:opacity-90"
							onPress={() => {
								// Collapse the expanded row first if it's one of the selected duplicates -- its
								// own `useAMAQuestion` query would otherwise race the merge's cache invalidation
								// against a question id that's about to be deleted (same issue `QuestionDetailPanel`
								// guards against for the single-question merge flow).
								if (expandedId !== null && selectedIds.includes(expandedId)) {
									setExpandedId(null);
								}

								setShowBulkMerge(true);
							}}
							type="button"
						>
							Merge Selected as Duplicates
						</Button>
					</>
				)}
			</div>

			{showBulkMerge && selectedIds.length > 0 && (
				<BulkMergePicker onClose={() => setShowBulkMerge(false)} onMerged={exitSelectMode} questionIds={selectedIds} />
			)}

			{authorId && (
				<p className="flex flex-wrap items-center gap-2 text-sm text-secondary dark:text-secondary-dark">
					<span>Filtering by author{questions[0] ? ` ${userLabel(questions[0].author)}` : ''}.</span>
					<Button
						className="h-auto rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary hover:bg-misc-accent/10 hover:text-misc-accent dark:bg-on-tertiary-dark dark:text-primary-dark"
						onPress={() => setAuthorParam(null)}
					>
						Clear
					</Button>
				</p>
			)}

			{isLoading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-16 w-full rounded-lg" />
					<Skeleton className="h-16 w-full rounded-lg" />
					<Skeleton className="h-16 w-full rounded-lg" />
				</div>
			) : questions.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					{search ? `No questions match "${search}".` : 'No questions yet.'}
				</p>
			) : (
				<div className="flex flex-col gap-3">
					{questions.map((question) => (
						<QuestionRow
							isExpanded={expandedId === question.id}
							isSelected={selectedIds.includes(question.id)}
							key={question.id}
							onToggle={() => setExpandedId(expandedId === question.id ? null : question.id)}
							onToggleSelect={() => toggleSelected(question.id)}
							question={question}
							selectMode={selectMode}
						/>
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
