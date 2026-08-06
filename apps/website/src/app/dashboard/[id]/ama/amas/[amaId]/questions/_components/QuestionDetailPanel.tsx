'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthorAvatar } from './AuthorAvatar';
import { MergeDuplicatePicker } from './MergeDuplicatePicker';
import { TagPicker } from './TagPicker';
import { MERGEABLE_STATES } from './mergeableStates';
import { userLabel } from './userLabel';
import { APIError } from '@/api/error';
import { useAMA, useAMAQuestion, useSendAMAQuestion, useUpdateAMAQuestion } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';

interface QuestionDetailPanelProps {
	onMerged(): void;
	readonly questionId: number;
}

const ACTIONABLE_STATES = new Set(['PENDING_MOD_REVIEW', 'PENDING_GUEST_REVIEW']);

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
	const canFlag = question.state === 'PENDING_MOD_REVIEW';
	const canSend = question.state === 'APPROVED';
	const canMerge = MERGEABLE_STATES.has(question.state);
	// Once sent, the answer already went out in the Discord message as-is -- editing it here would just
	// be silently lying to whoever's looking at the dashboard, so it's disabled outright instead of
	// allowed-with-a-caveat.
	const canEditAnswer = question.state !== 'ASKED';
	// FLAGGED and DENIED never had (and never will have) a prepared answer -- both only happen straight
	// from PENDING_MOD_REVIEW/PENDING_GUEST_REVIEW (see updateQuestion.ts), so there's nothing for this
	// editor to show once a question lands there; hide it outright instead of an empty disabled form.
	const showAnswerEditor = question.state !== 'FLAGGED' && question.state !== 'DENIED';

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
							and {question.extraAskers.length} {question.extraAskers.length === 1 ? 'other' : 'others'}:
						</p>
						<div className="mt-1 flex flex-col gap-1">
							{question.extraAskers.map((asker) => {
								const authorId = typeof asker.author === 'string' ? asker.author : asker.author.id;
								return (
									<div className="flex items-center gap-2" key={authorId}>
										<AuthorAvatar className="h-5 w-5 rounded-full" user={asker.author} />
										<p className="text-sm text-primary dark:text-primary-dark">{userLabel(asker.author)}</p>
										<p className="text-xs text-secondary dark:text-secondary-dark">({authorId})</p>
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
					<p className="text-sm font-medium text-secondary dark:text-secondary-dark">
						Answer {!canEditAnswer && '(already sent)'}
					</p>
					<textarea
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none disabled:opacity-50 dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						disabled={!canEditAnswer}
						maxLength={4_000}
						onChange={(e) => setAnswerContent(e.target.value)}
						placeholder="Prepare an answer ahead of time..."
						rows={4}
						value={answerContent}
					/>
					<input
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none disabled:opacity-50 dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						disabled={!canEditAnswer}
						onChange={(e) => setAnswerImageUrl(e.target.value)}
						placeholder="Answer image URL (optional)"
						type="text"
						value={answerImageUrl}
					/>
					{ama && ama.guests.length > 0 && (
						<div>
							<label
								className="mb-1 block text-xs font-medium text-secondary dark:text-secondary-dark"
								htmlFor="answered-by"
							>
								Answered by
							</label>
							<select
								className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none disabled:opacity-50 dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
								disabled={!canEditAnswer}
								id="answered-by"
								onChange={(e) => setAnsweredById(e.target.value)}
								value={answeredById}
							>
								{/* Explicit, not just an empty placeholder -- leaving this selected and hitting Save
								Answer really does default to whoever's logged into the dashboard right now, not
								"nobody"/unset. */}
								<option value="">Default - answered by you (dashboard user)</option>
								{ama.guests.map((guest) => {
									const guestId = typeof guest === 'string' ? guest : guest.id;
									return (
										<option key={guestId} value={guestId}>
											{userLabel(guest)}
										</option>
									);
								})}
							</select>
						</div>
					)}
					{canEditAnswer && (
						<Button
							className="h-8 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
							isDisabled={updateQuestion.isPending || !answerContent.trim()}
							onPress={async () =>
								runAction(async () =>
									updateQuestion.mutateAsync({
										answerContent: answerContent.trim(),
										answerImageUrl: answerImageUrl.trim() || null,
										answeredById: answeredById || null,
									}),
								)
							}
							type="button"
						>
							Save Answer
						</Button>
					)}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				{canTriage && (
					<>
						<Button
							className="h-9 bg-misc-accent px-3 text-sm text-white hover:opacity-90"
							isDisabled={updateQuestion.isPending}
							onPress={async () => runAction(async () => updateQuestion.mutateAsync({ state: 'APPROVED' }))}
							type="button"
						>
							Approve
						</Button>
						<Button
							className="h-9 bg-misc-danger px-3 text-sm text-white hover:opacity-90"
							isDisabled={updateQuestion.isPending}
							onPress={async () => runAction(async () => updateQuestion.mutateAsync({ state: 'DENIED' }))}
							type="button"
						>
							Deny
						</Button>
						{canFlag && (
							<Button
								className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
								isDisabled={updateQuestion.isPending}
								onPress={async () => runAction(async () => updateQuestion.mutateAsync({ state: 'FLAGGED' }))}
								type="button"
							>
								Flag
							</Button>
						)}
					</>
				)}
				{canSend && (
					<Button
						className="h-9 bg-misc-accent px-3 text-sm text-white hover:opacity-90"
						isDisabled={sendQuestion.isPending}
						onPress={async () => runAction(async () => sendQuestion.mutateAsync())}
						type="button"
					>
						Send
					</Button>
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
