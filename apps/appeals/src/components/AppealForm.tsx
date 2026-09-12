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
	/**
	 * Whether the account could actually be added back, from `/auth/me` -- the capability, separate from the
	 * consent below it. `false` leaves the box tickable and says why it would not work yet: the consent is about
	 * this appeal and is worth recording either way, and signing in again before a decision lands makes it real.
	 */
	readonly canRejoin: boolean;
	readonly guildId: string;
	readonly questions: AppealFormQuestion[];
}

export function AppealForm({ guildId, questions, appealsRemaining, canRejoin }: AppealFormProps) {
	const [answers, setAnswers] = useState<Record<number, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [missing, setMissing] = useState<Set<number>>(new Set());
	// Unticked, and it stays that way until they tick it: this is the one field on the form that is a consent
	// rather than an answer, and a pre-ticked consent is not one.
	const [rejoinConsent, setRejoinConsent] = useState(false);
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
				rejoinConsent,
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

			{/* Last, under the questions, because it is not one of them: the guild asked those, and this is the
			    site asking what to do if the answers work. */}
			<div>
				<label className="flex items-start gap-2" htmlFor="appeal-rejoin-consent">
					<input
						checked={rejoinConsent}
						className="mt-1 h-4 w-4 shrink-0 rounded border-on-secondary dark:border-on-secondary-dark"
						id="appeal-rejoin-consent"
						onChange={(event) => setRejoinConsent(event.target.checked)}
						type="checkbox"
					/>
					<span className="text-sm text-primary dark:text-primary-dark">
						If the moderators of this server choose to, I consent to being automatically re-added to the server if my
						appeal is accepted.
					</span>
				</label>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					Optional, and only some servers use it. Leave it unticked and an accepted appeal simply lifts the ban -- you
					will be sent an invite instead, and can rejoin whenever you like.
				</p>
				{/* Deliberately not a "sign in again" link, which is what this was first written as: that is a round
				    trip to Discord that lands them back on an empty form, so taking the advice would have cost them
				    everything they had typed to reach it. The consent is recorded either way, and `RejoinGrantPrompt`
				    offers the grant once the appeal is filed and there is nothing left to lose. */}
				{rejoinConsent && !canRejoin && (
					<p className="mt-1 text-sm text-misc-warning dark:text-misc-warning-dark">
						You did not give us permission to add you to servers when you signed in, so this cannot happen yet. Tick it
						anyway -- we will ask you for that permission here once your appeal is in.
					</p>
				)}
			</div>

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
