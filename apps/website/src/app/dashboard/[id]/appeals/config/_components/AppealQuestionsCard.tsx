'use client';

import { DEFAULT_APPEAL_QUESTIONS } from '@chatsift/core';
import type { AppealQuestion } from '@/api/routes/appeals';

interface AppealQuestionsCardProps {
	readonly questions: readonly AppealQuestion[];
}

/**
 * The questionnaire an appellant fills in, shown read-only until P7 makes it editable.
 *
 * Rendered from `DEFAULT_APPEAL_QUESTIONS` while the list is empty, which is exactly as long as the guild has
 * no settings row -- the API seeds real rows on the first save (see `updateConfig.ts`). Showing the defaults
 * rather than an empty card is what makes the setup screen say what saving will produce, and both paths render
 * the same questions because both read the same constant.
 */
export function AppealQuestionsCard({ questions }: AppealQuestionsCardProps) {
	const displayed: readonly { prompt: string; required: boolean }[] =
		questions.length > 0 ? questions : DEFAULT_APPEAL_QUESTIONS;
	const isSeeded = questions.length > 0;

	return (
		<div className="space-y-3 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
			<div>
				<h2 className="text-lg font-medium text-primary dark:text-primary-dark">Appeal Questions</h2>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					{isSeeded
						? 'What an appellant is asked when they file. Editing these is coming later; for now every server asks the same set.'
						: 'What an appellant will be asked when they file. This set is added to your server when you save.'}
				</p>
			</div>

			<ol className="space-y-2">
				{displayed.map((question, index) => (
					<li
						className="flex items-start gap-3 rounded-md border border-on-secondary p-3 dark:border-on-secondary-dark"
						key={question.prompt}
					>
						<span className="text-sm text-secondary tabular-nums dark:text-secondary-dark">{index + 1}.</span>
						<span className="flex-1 text-sm text-primary dark:text-primary-dark">{question.prompt}</span>
						{!question.required && (
							<span className="shrink-0 text-xs text-secondary dark:text-secondary-dark">Optional</span>
						)}
					</li>
				))}
			</ol>
		</div>
	);
}
