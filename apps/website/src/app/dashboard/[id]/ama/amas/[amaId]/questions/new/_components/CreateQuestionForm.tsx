'use client';

import { AMA_QOL_EXPERIMENT } from '@chatsift/core';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { FaLock } from 'react-icons/fa';
import { APIError } from '@/api/error';
import { useCreateAMAQuestion } from '@/api/routes/ama';
import { EmptyState } from '@/components/common/EmptyState';
import { FormActions } from '@/components/common/FormActions';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { TextAreaField } from '@/components/common/TextAreaField';
import { useExperiment } from '@/hooks/useExperiment';

const MAX_CONTENT_LENGTH = 4_000;

/**
 * Writes an "umbrella question" (#366): the host phrases the question the way they want to answer it, then
 * merges the real submissions into it from the list, so the published wording is theirs while the tally still
 * credits everyone who asked.
 *
 * It's created `APPROVED` rather than posted, so nothing reaches the answers channel until the existing Send
 * action runs -- see `createQuestion.ts` for why that state and not another.
 */
export function CreateQuestionForm() {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const router = useRouter();
	const createQuestion = useCreateAMAQuestion(guildId, amaId);

	const [content, setContent] = useState('');
	// Defaults to hidden: an umbrella question's author is whichever moderator happened to type it, which is
	// exactly the name the request was about keeping off the answers channel.
	const [anonymous, setAnonymous] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const isQolEnabled = useExperiment(guildId, AMA_QOL_EXPERIMENT);

	const questionsHref = `/dashboard/${guildId}/ama/amas/${amaId}/questions`;

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		setError(null);

		try {
			// No empty-content guard: `FormActions` is disabled on a blank textarea, and a form whose only field is
			// a textarea has no implicit submission, so there is no way to reach this with nothing typed.
			await createQuestion.mutateAsync({ content: content.trim(), anonymous });
			router.replace(questionsHref);
		} catch (submitError) {
			setError(submitError instanceof APIError ? submitError.message : 'Something went wrong. Please try again.');
		}
	};

	// Nothing links here with the gate off, but the route is still reachable by typing the URL (or from a stale
	// tab open from before it was switched off) -- rendering a form whose submit the API is going to refuse
	// would be worse than saying so.
	if (!isQolEnabled) {
		return (
			<EmptyState
				icon={<FaLock className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
				subtitle="Umbrella questions aren't enabled for this server."
				title="Not available"
			/>
		);
	}

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{error && <p className="text-sm text-misc-danger">{error}</p>}

			<TextAreaField
				helper="Duplicates get merged into this one from the questions list, and it publishes through the usual Send action - nothing is posted yet."
				id="umbrella-question-content"
				label="Question"
				maxLength={MAX_CONTENT_LENGTH}
				onChange={setContent}
				placeholder="What is the plan for next season?"
				rows={5}
				value={content}
			/>

			<div>
				<span
					className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
					id="umbrella-question-anonymous-label"
				>
					Author, where this gets published
				</span>
				<SegmentedControl
					labelledBy="umbrella-question-anonymous-label"
					onChange={(next) => setAnonymous(next)}
					options={[
						{ label: 'Shown', value: false },
						{ label: 'Hidden', value: true },
					]}
					value={anonymous}
				/>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					Shown credits you - the question is recorded as yours either way, this only controls whether the answers
					channel and the public page say so.
				</p>
			</div>

			<FormActions
				isSubmitDisabled={!content.trim()}
				isSubmitting={createQuestion.isPending}
				onCancel={() => router.back()}
				pendingLabel="Creating..."
				submitLabel="Create question"
			/>
		</form>
	);
}
