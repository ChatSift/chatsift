'use client';

import { AMA_QOL_EXPERIMENT, amaQuestionsChannel, MERGE_SOURCE_STATES } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Focusable } from 'react-aria-components';
import { FaEyeSlash } from 'react-icons/fa';
import { AuthorAvatar } from './AuthorAvatar';
import { BulkMergePicker } from './BulkMergePicker';
import { QuestionDetailPanel } from './QuestionDetailPanel';
import { useQuestionStateFilter } from './QuestionStateTabs';
import { useTagFilter } from './QuestionTagFilter';
import { DEFAULT_STATE_CHIP_CLASS, STATE_CHIP_CLASSES, STATE_LABELS } from './questionState';
import { userLabel } from './userLabel';
import type { AMAQuestionListItem } from '@/api/routes/ama';
import { invalidateAMAQuestions, useAMAQuestions, useSetAMAQuestionsAnonymousBulk } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { Tooltip } from '@/components/common/Tooltip';
import { buttonClass } from '@/components/common/buttonStyles';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useExperiment } from '@/hooks/useExperiment';
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
	readonly isQolEnabled: boolean;
	readonly isSelected: boolean;
	onToggle(): void;
	onToggleSelect(): void;
	readonly question: AMAQuestionListItem;
	readonly selectMode: boolean;
}

function QuestionRow({
	isExpanded,
	isQolEnabled,
	isSelected,
	onToggle,
	onToggleSelect,
	question,
	selectMode,
}: QuestionRowProps) {
	const [, setAuthorParam] = useURLParam('author');
	const [, setTagParam] = useURLParam('tag');
	const [, setTabParam] = useURLParam('tab');

	const stateToTab: Record<string, string> = {
		PENDING_REVIEW: 'pending',
		APPROVED: 'guest-questions',
		ASKED: 'asked',
		DENIED: 'denied',
	};

	const canSelect = isQolEnabled || MERGE_SOURCE_STATES.has(question.state);

	return (
		<div className="rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 flex-1 items-start gap-3">
					{/* Selectable in every state once #366's gate is on: the selection then drives the anonymity actions
					as well as merging, and those apply to a question at any point in its life (merging is the
					narrower of the two, so its own precondition is checked on the merge action instead). With the
					gate off, merging is all the selection can do, so it goes back to only offering the rows that
					can actually be merged away. */}
					{selectMode && (
						<input
							aria-label={`Select question #${question.id}`}
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
					{isQolEnabled && (question.anonymous || question.umbrella) && (
						// Not clickable like the chips around it -- there's no "anonymous" filter to jump into, and this
						// is here so a moderator can tell at a glance which rows publish without an author (#366). An
						// icon rather than the word it used to spell out (#366 PM feedback): it sits on a row that
						// already carries an avatar, a name, the tags and the state, and this is the one of those a
						// moderator is least often reading. `Focusable` because a tooltip nobody can reach with a
						// keyboard is not an explanation.
						<Tooltip
							content={
								question.umbrella
									? `Umbrella question - published with no author, ${question.showAskerCount ? 'as "Asked by X people"' : 'and with no merge count'}.`
									: 'Published with no author on it.'
							}
						>
							<Focusable>
								<span
									aria-label={
										question.umbrella ? 'Umbrella question, published with no author' : 'Published with no author'
									}
									className="rounded-full bg-on-tertiary p-1.5 text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark"
									role="img"
								>
									<FaEyeSlash className="h-3.5 w-3.5" />
								</span>
							</Focusable>
						</Tooltip>
					)}
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
	// Only ever set on a *partial* success: the request went through but some already-posted message couldn't be
	// rewritten (#366). An outright failure never reaches this -- `Button` surfaces a rejected `onPress` itself.
	const [bulkNotice, setBulkNotice] = useState<string | null>(null);
	const setQuestionsAnonymous = useSetAMAQuestionsAnonymousBulk(guildId, amaId);
	// #366's controls are gated. With it off the list is exactly what it was before: select-to-merge only, no
	// umbrella-question entry point, no anonymity chip.
	const isQolEnabled = useExperiment(guildId, AMA_QOL_EXPERIMENT);

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

	// Merging is the narrower of the two bulk actions: every question merged *away* is deleted, which
	// `MERGE_SOURCE_STATES` limits to PENDING_REVIEW. Anonymity has no such restriction, so the selection itself
	// stays open and this only hides the merge action when the batch can't go through it (#366).
	const selectedQuestions = questions.filter((question) => selectedIds.includes(question.id));
	const canBulkMerge =
		selectedQuestions.length === selectedIds.length &&
		selectedQuestions.every((question) => MERGE_SOURCE_STATES.has(question.state));

	const runBulkAnonymous = async (anonymous: boolean) => {
		setBulkNotice(null);
		const result = await setQuestionsAnonymous.mutateAsync({ anonymous, questionIds: selectedIds });
		exitSelectMode();

		if (result.failedToRefresh.length > 0) {
			setBulkNotice(
				`Saved, but the answers-channel message for #${result.failedToRefresh.join(', #')} couldn't be rewritten. ` +
					'Open the question and use its own toggle to retry.',
			);
		}
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
					{selectMode ? 'Cancel Selection' : isQolEnabled ? 'Select Questions' : 'Select Duplicates'}
				</Button>
				{!selectMode && isQolEnabled && (
					<Link
						className={buttonClass('secondary', 'sm')}
						href={`/dashboard/${guildId}/ama/amas/${amaId}/questions/new`}
					>
						New umbrella question
					</Link>
				)}
				{selectMode && selectedIds.length > 0 && (
					<>
						<span className="text-sm text-secondary dark:text-secondary-dark">{selectedIds.length} selected</span>
						{canBulkMerge && (
							<Button
								className="h-9 bg-misc-accent px-3 text-sm text-accent hover:opacity-90"
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
						)}
						{isQolEnabled && (
							<>
								<Button
									className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
									isDisabled={setQuestionsAnonymous.isPending}
									onPress={async () => runBulkAnonymous(true)}
									type="button"
								>
									Hide authors
								</Button>
								<Button
									className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
									isDisabled={setQuestionsAnonymous.isPending}
									onPress={async () => runBulkAnonymous(false)}
									type="button"
								>
									Show authors
								</Button>
							</>
						)}
					</>
				)}
			</div>

			{bulkNotice && <p className="text-sm text-misc-warning">{bulkNotice}</p>}

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
							isQolEnabled={isQolEnabled}
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
