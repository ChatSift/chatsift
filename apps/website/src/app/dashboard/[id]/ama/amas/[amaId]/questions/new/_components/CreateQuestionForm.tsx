'use client';

import { APIError } from '@chatsift/web-core/api/error';
import { FormActions } from '@chatsift/web-core/components/FormActions';
import { SegmentedControl } from '@chatsift/web-core/components/SegmentedControl';
import { TextAreaField } from '@chatsift/web-core/components/TextAreaField';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCreateAMAQuestion } from '@/api/routes/ama';

const MAX_CONTENT_LENGTH = 4_000;

/**
 * Writes an "umbrella question" (#366): the host phrases the question the way they want to answer it, then
 * merges the real submissions into it from the list, so the published wording is theirs while the tally still
 * credits everyone who asked. Nothing published names the moderator who typed it, which is why this form has
 * no author control at all -- only whether the tally itself shows.
 *
 * It's created `APPROVED` rather than posted, so nothing reaches the answers channel until the existing Send
 * action runs -- see `createQuestion.ts` for why that state and not another.
 */
export function CreateQuestionForm() {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const router = useRouter();
	const createQuestion = useCreateAMAQuestion(guildId, amaId);

	const [content, setContent] = useState('');
	// The author isn't a choice here at all: an umbrella question's author is whichever moderator happened to
	// type it, so nothing published ever names them (`createQuestion.ts` stores the row anonymous). What is a
	// choice is the merged-asker tally, which is the only thing one of these can say about who asked -- shown
	// by default, since a host writing an umbrella question is usually doing it to credit a crowd.
	const [showAskerCount, setShowAskerCount] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const questionsHref = `/dashboard/${guildId}/ama/amas/${amaId}/questions`;

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		setError(null);

		try {
			// No empty-content guard: `FormActions` is disabled on a blank textarea, and a form whose only field is
			// a textarea has no implicit submission, so there is no way to reach this with nothing typed.
			await createQuestion.mutateAsync({ content: content.trim(), showAskerCount });
			router.replace(questionsHref);
		} catch (submitError) {
			setError(submitError instanceof APIError ? submitError.message : 'Something went wrong. Please try again.');
		}
	};

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
					id="umbrella-question-asker-count-label"
				>
					Merge count
				</span>
				<SegmentedControl
					labelledBy="umbrella-question-asker-count-label"
					onChange={(next) => setShowAskerCount(next)}
					options={[
						{ label: 'Show', value: true },
						{ label: 'Hide', value: false },
					]}
					value={showAskerCount}
				/>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					Umbrella questions do not have authors, instead saying &quot;Asked by X people&quot; based on the number of
					merged questions under the umbrella. Hiding will only show the question.
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
