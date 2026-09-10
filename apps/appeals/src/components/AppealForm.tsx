'use client';

import type { AppealFormQuestion } from '@chatsift/api';
import { APPEAL_ANSWER_MAX_LENGTH } from '@chatsift/core';
import { APIError } from '@chatsift/web-core/api/error';
import { Button } from '@chatsift/web-core/components/Button';
import { TextAreaField } from '@chatsift/web-core/components/TextAreaField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useState } from 'react';
import { useSubmitAppeal } from '@/api/routes/appeals';

interface AppealFormProps {
	/**
	 * How many appeals they have left here, or `null` when the guild sets no ceiling. Shown before they write
	 * anything rather than after they submit -- somebody on their last attempt should know it while they can
	 * still act on it.
	 */
	readonly appealsRemaining: number | null;
	readonly guildId: string;
	readonly questions: AppealFormQuestion[];
}

export function AppealForm({ guildId, questions, appealsRemaining }: AppealFormProps) {
	const [answers, setAnswers] = useState<Record<number, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [missing, setMissing] = useState<Set<number>>(new Set());
	const submit = useSubmitAppeal(guildId);

	async function onSubmit(): Promise<void> {
		// Checked here as well as in the API, which is the authority -- this half exists to point at the
		// specific empty box rather than answering the whole form with one sentence.
		const empty = new Set(
			questions.filter((question) => question.required && !(answers[question.id] ?? '').trim()).map((q) => q.id),
		);
		setMissing(empty);
		if (empty.size) {
			setError('Please answer every required question.');
			return;
		}

		setError(null);
		try {
			// Every question is sent, including optional ones left blank, which arrive as empty strings. That is
			// load-bearing rather than lazy: the API writes those rows too (see `submitAppeal.ts`), so the
			// mod-side embed renders the guild's whole form and "they declined to answer this" stays visible.
			await submit.mutateAsync({
				answers: questions.map((question) => ({
					questionId: question.id,
					answer: (answers[question.id] ?? '').trim(),
				})),
			});
		} catch (error_) {
			// The API re-runs the whole eligibility ladder at submit time (`evaluateAppealEligibility`), so a
			// refusal here is usually something that changed while they were typing -- unbanned, listed, past a
			// ceiling. Its message is written for the appellant, so it is shown verbatim.
			setError(error_ instanceof APIError ? error_.message : 'Something went wrong. Please try again.');
		}
	}

	return (
		<form
			className="flex flex-col gap-6"
			onSubmit={async (event) => {
				event.preventDefault();
				await onSubmit();
			}}
		>
			{questions.map((question) => (
				<TextAreaField
					error={missing.has(question.id) ? 'This question is required.' : undefined}
					helper={question.required ? undefined : 'Optional'}
					id={`question-${question.id}`}
					key={question.id}
					label={question.prompt}
					maxLength={APPEAL_ANSWER_MAX_LENGTH}
					onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
					rows={4}
					value={answers[question.id] ?? ''}
				/>
			))}

			{error && <p className="text-sm text-misc-danger">{error}</p>}

			<div className="flex flex-col gap-2">
				<Button className={buttonClass('primary')} isDisabled={submit.isPending} type="submit">
					{submit.isPending ? 'Submitting...' : 'Submit appeal'}
				</Button>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					{appealsRemaining === null
						? 'Your answers are sent to the moderators of this server. You cannot edit an appeal after submitting it.'
						: `Your answers are sent to the moderators of this server. You cannot edit an appeal after submitting it, and you have ${appealsRemaining} ${appealsRemaining === 1 ? 'attempt' : 'attempts'} left here.`}
				</p>
			</div>
		</form>
	);
}
