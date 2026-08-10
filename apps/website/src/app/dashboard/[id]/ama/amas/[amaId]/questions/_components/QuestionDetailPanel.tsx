'use client';

import { MERGE_SOURCE_STATES } from '@chatsift/core';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FaCheck } from 'react-icons/fa';
import { AuthorAvatar } from './AuthorAvatar';
import { MergeDuplicatePicker } from './MergeDuplicatePicker';
import { TagPicker } from './TagPicker';
import { userLabel } from './userLabel';
import { APIError } from '@/api/error';
import { useAMA, useAMAQuestion, useSendAMAQuestion, useUpdateAMAQuestion } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Skeleton } from '@/components/common/Skeleton';
import { cn, formatDate } from '@/utils/util';

interface QuestionDetailPanelProps {
	onMerged(): void;
	readonly questionId: number;
}

const ACTIONABLE_STATES = new Set(['PENDING_REVIEW']);

export function QuestionDetailPanel({ onMerged, questionId }: QuestionDetailPanelProps) {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	// Disabled the instant a merge naming this question as the duplicate starts (see
	// `MergeDuplicatePicker`'s `onMergingChange`) -- otherwise the merge's own cache invalidation can
	// race this still-mounted query against the question's now-deleted id and 404.
	const [isMerging, setIsMerging] = useState(false);
	const { data: question, isLoading } = useAMAQuestion(guildId, amaId, questionId, !isMerging);
	const { data: ama } = useAMA(guildId, amaId);
	const updateQuestion = useUpdateAMAQuestion(guildId, amaId, questionId);
	const sendQuestion = useSendAMAQuestion(guildId, amaId, questionId);

	const [answerContent, setAnswerContent] = useState('');
	const [answerImageUrl, setAnswerImageUrl] = useState('');
	// Empty string means "default (you)" -- not one of `ama.guests`' own ids, which are always non-empty
	// snowflakes, so there's no ambiguity between "nothing selected" and a real guest id.
	const [answeredById, setAnsweredById] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [showMerge, setShowMerge] = useState(false);
	const [showSaveConfirm, setShowSaveConfirm] = useState(false);

	useEffect(() => {
		if (question) {
			setAnswerContent(question.answerContent ?? '');
			setAnswerImageUrl(question.answerImageUrl ?? '');
			setAnsweredById(question.answeredById ?? '');
		}
	}, [question]);

	if (isLoading || !question) {
		return <Skeleton className="h-40 w-full" />;
	}

	const runAction = async (action: () => Promise<unknown>) => {
		setError(null);
		try {
			await action();
		} catch (actionError) {
			setError(actionError instanceof APIError ? actionError.message : 'Something went wrong. Please try again.');
		}
	};

	const canTriage = ACTIONABLE_STATES.has(question.state);
	const canMerge = MERGE_SOURCE_STATES.has(question.state);
	// The answer editor shows for a question awaiting a prepared answer, and (since #327) for one that's
	// already been sent -- editing there rewrites the live Discord message rather than diverging from it,
	// so the dashboard isn't claiming anything the answers channel doesn't also say. PENDING_REVIEW and
	// DENIED get nothing: neither is "pending to be posted", and DENIED never had an answer to begin with.
	const isSent = question.state === 'ASKED';
	const showAnswerEditor = question.state === 'APPROVED' || isSent;
	const answeredByUser = question.answeredById
		? (ama?.guests.find((guest) => (typeof guest === 'string' ? guest : guest.id) === question.answeredById) ??
			question.answeredById)
		: null;
	// Whether the recorded answerer is someone the picker below can actually represent. They often aren't:
	// picking "Default (you)" stores the acting dashboard user's id, and a sent question always has one
	// recorded -- so a plain moderator ends up in this column routinely, as does a guest who's since been
	// removed from the AMA.
	const isAnsweredByGuest = Boolean(
		question.answeredById &&
		ama?.guests.some((guest) => (typeof guest === 'string' ? guest : guest.id) === question.answeredById),
	);

	// Empty means "no prepared answer" -- the API rejects an empty string outright (min length 1), so that
	// has to be `null`, not `''`. Shared by Save and Send so the two can't drift on that.
	const saveAnswer = async () =>
		updateQuestion.mutateAsync({
			answerContent: answerContent.trim() || null,
			answerImageUrl: answerImageUrl.trim() || null,
			// Sent only when it actually changed. The route reads a missing key as "leave as-is" (that
			// distinction is load-bearing there), and echoing the untouched value back would 400 whenever the
			// recorded answerer isn't one of the configured guests -- see `isAnsweredByGuest`, which is the
			// common case for anything already sent.
			...(answeredById === (question.answeredById ?? '') ? {} : { answeredById: answeredById || null }),
		});

	const handleSendAnswer = async () =>
		runAction(async () => {
			await saveAnswer();
			await sendQuestion.mutateAsync();
		});

	return (
		<div className="space-y-4 rounded-lg border border-on-secondary bg-on-tertiary/30 p-4 dark:border-on-secondary-dark dark:bg-on-tertiary-dark/30">
			{error && <p className="text-sm text-misc-danger">{error}</p>}

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Question</p>
				<p className="whitespace-pre-wrap wrap-break-word text-primary dark:text-primary-dark">{question.content}</p>
			</div>

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Asked by</p>
				<div className="flex items-center gap-2">
					<AuthorAvatar user={question.author} />
					<div>
						<p className="text-lg text-primary dark:text-primary-dark">{userLabel(question.author)}</p>
						<p className="text-xs text-secondary dark:text-secondary-dark">{question.authorId}</p>
					</div>
				</div>
				{question.extraAskers.length > 0 && (
					<div className="mt-2">
						<p className="text-xs text-secondary dark:text-secondary-dark">
							Merged {question.extraAskers.length} duplicate{question.extraAskers.length === 1 ? '' : 's'}:
						</p>
						<div className="mt-1 flex flex-col gap-2">
							{question.extraAskers.map((asker) => {
								const authorId = typeof asker.author === 'string' ? asker.author : asker.author.id;
								return (
									<div
										className="rounded-md border border-on-secondary p-2 dark:border-on-secondary-dark"
										key={authorId}
									>
										<div className="flex items-center gap-2">
											<AuthorAvatar className="h-5 w-5 rounded-full" user={asker.author} />
											<p className="text-sm text-primary dark:text-primary-dark">{userLabel(asker.author)}</p>
											<p className="text-xs text-secondary dark:text-secondary-dark">
												merged {formatDate(new Date(asker.mergedAt))}
											</p>
										</div>
										<p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-secondary dark:text-secondary-dark">
											{asker.content ?? <em>Original message unavailable (merged before this was tracked)</em>}
										</p>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Tags</p>
				<TagPicker
					assignedTagIds={question.tags.map((tag) => tag.id)}
					onChange={async (tagIds) => runAction(async () => updateQuestion.mutateAsync({ tagIds }))}
				/>
			</div>

			{showAnswerEditor && (
				<div className="space-y-2">
					<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Answer</p>
					{isSent && (
						<p className="text-xs text-secondary dark:text-secondary-dark">
							Already sent — saving edits the message that&apos;s live in the answers channel, and the public answers
							page.
						</p>
					)}
					{/* Who's currently recorded as the answerer, shown whenever the picker below can't show it
					itself -- either because there are no guests (so it doesn't render) or because whoever
					answered isn't one of them (so it renders with nothing selected). */}
					{answeredByUser && !isAnsweredByGuest && (
						<div className="flex items-center gap-2">
							<AuthorAvatar className="h-5 w-5 rounded-full" user={answeredByUser} />
							<p className="text-xs text-secondary dark:text-secondary-dark">Answered by {userLabel(answeredByUser)}</p>
						</div>
					)}
					<textarea
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none disabled:opacity-50 dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						maxLength={4_000}
						onChange={(e) => setAnswerContent(e.target.value)}
						placeholder="Write the answer..."
						rows={4}
						value={answerContent}
					/>
					<input
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none disabled:opacity-50 dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						onChange={(e) => setAnswerImageUrl(e.target.value)}
						placeholder="Answer image URL (optional)"
						type="text"
						value={answerImageUrl}
					/>
					{ama && ama.guests.length > 0 && (
						<div>
							<span className="mb-1 block text-xs font-medium text-secondary dark:text-secondary-dark">
								Answered by
							</span>
							<div className="flex flex-col gap-1.5">
								{/* An explicit row, not just an empty/placeholder state -- leaving this selected and
								hitting Send really does default to whoever's logged into the dashboard right now,
								not "nobody"/unset. */}
								<Button
									aria-pressed={answeredById === ''}
									className={cn(
										'w-full justify-start gap-2 rounded-md border px-3 py-2 text-left text-sm',
										answeredById === ''
											? 'border-misc-accent bg-misc-accent/10 text-misc-accent'
											: 'border-on-secondary text-primary dark:border-on-secondary-dark dark:text-primary-dark',
									)}
									onPress={() => setAnsweredById('')}
									type="button"
								>
									<span className="min-w-0 flex-1 whitespace-normal wrap-break-word">
										Default - answered by you (dashboard user)
									</span>
									{answeredById === '' && <FaCheck className="h-3.5 w-3.5 shrink-0" />}
								</Button>
								{ama.guests.map((guest) => {
									const guestId = typeof guest === 'string' ? guest : guest.id;
									const isSelected = answeredById === guestId;
									return (
										<Button
											aria-pressed={isSelected}
											className={cn(
												'w-full justify-start gap-2 rounded-md border px-3 py-2 text-left text-sm',
												isSelected
													? 'border-misc-accent bg-misc-accent/10'
													: 'border-on-secondary dark:border-on-secondary-dark',
											)}
											key={guestId}
											onPress={() => setAnsweredById(guestId)}
											type="button"
										>
											<AuthorAvatar className="h-5 w-5 shrink-0 rounded-full" user={guest} />
											<span
												className={cn(
													'min-w-0 flex-1 truncate',
													isSelected ? 'text-misc-accent' : 'text-primary dark:text-primary-dark',
												)}
											>
												{userLabel(guest)}
											</span>
											<span className="shrink-0 text-xs text-secondary dark:text-secondary-dark">({guestId})</span>
											{isSelected && <FaCheck className="h-3.5 w-3.5 shrink-0 text-misc-accent" />}
										</Button>
									);
								})}
							</div>
						</div>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							className={cn(
								'h-9 px-3 text-sm',
								isSent
									? 'bg-misc-accent text-accent hover:opacity-90'
									: 'border border-on-secondary dark:border-on-secondary-dark',
							)}
							isDisabled={updateQuestion.isPending || sendQuestion.isPending}
							// A sent question's edit is confirmed first -- it rewrites something already public in
							// two places. Nothing to confirm before it's sent: that answer is still a draft.
							onPress={async () => (isSent ? setShowSaveConfirm(true) : runAction(saveAnswer))}
							type="button"
						>
							{isSent ? 'Save changes' : 'Save Answer'}
						</Button>
						{!isSent && (
							<Button
								className="h-9 bg-misc-accent px-3 text-sm text-accent hover:opacity-90"
								isDisabled={updateQuestion.isPending || sendQuestion.isPending}
								onPress={handleSendAnswer}
								type="button"
							>
								Send
							</Button>
						)}
					</div>
				</div>
			)}

			{/* Mounted outside the editor block rather than next to its button, so it survives anything that
			could unmount that subtree mid-action -- same reasoning as `TagPicker`'s own confirm. */}
			<ConfirmModal
				confirmLabel="Save changes"
				isOpen={showSaveConfirm}
				// Raw, not wrapped in `runAction`: this is the one place the panel *wants* a rejection to
				// propagate. `ConfirmModal` only closes once `onConfirm` resolves, so a failed edit (the API
				// refuses to save anything it couldn't push to Discord) leaves the dialog up with `Button`'s
				// error banner over it, rather than closing onto an inline message the modal was covering.
				onConfirm={async () => void (await saveAnswer())}
				onOpenChange={setShowSaveConfirm}
				title="Edit a sent answer?"
			>
				<p>
					This question has already been sent. Saving rewrites the existing message in the answers channel and updates
					the public answers page - anyone who already read it will see the new text.
				</p>
			</ConfirmModal>

			<div className="flex flex-wrap gap-2">
				{canTriage && (
					<>
						<Button
							className="h-9 bg-misc-accent px-3 text-sm text-accent hover:opacity-90"
							isDisabled={updateQuestion.isPending}
							onPress={async () => runAction(async () => updateQuestion.mutateAsync({ state: 'APPROVED' }))}
							type="button"
						>
							Approve
						</Button>
						<Button
							className="h-9 bg-misc-danger px-3 text-sm text-accent hover:opacity-90"
							isDisabled={updateQuestion.isPending}
							onPress={async () => runAction(async () => updateQuestion.mutateAsync({ state: 'DENIED' }))}
							type="button"
						>
							Deny
						</Button>
					</>
				)}
				{canMerge && (
					<Button
						className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
						onPress={() => setShowMerge(!showMerge)}
						type="button"
					>
						Mark Duplicate
					</Button>
				)}
			</div>

			{showMerge && canMerge && (
				<MergeDuplicatePicker
					onClose={() => setShowMerge(false)}
					onMerged={onMerged}
					onMergingChange={setIsMerging}
					questionId={question.id}
				/>
			)}
		</div>
	);
}
