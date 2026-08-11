/**
 * What the answer editor says above the textarea for a question that's already 'ASKED'. Two independent
 * facts decide it, and conflating them is what made this wrong twice:
 *
 * - **`hasPublishedAnswer`** — whether an *answer* has actually gone out. Not the same as the question
 *   being 'ASKED': with review and prepared answers both off, `submitQuestion.ts` routes a question
 *   straight to 'ASKED' the moment it's submitted, so the ordinary setup produces plenty of 'ASKED'
 *   questions nobody has answered. Until one exists, the answers-channel message carries only the
 *   question embed and the public answers page doesn't list it at all (it filters on
 *   `answer_content IS NOT NULL`, see `publicAnswers.ts`) -- so nothing can be described as "already"
 *   anything, and the save needs no confirmation.
 * - **`postsToDiscord`** — whether this AMA has an answers channel (#316). A public-page-only one has no
 *   Discord message to mention.
 *
 * Extracted from `QuestionDetailPanel` so the four combinations can be pinned by tests; it lives beside
 * `questionState.ts`/`userLabel.ts` for the same "plain data, no React" reason.
 */
export function answerEditorHint(hasPublishedAnswer: boolean, postsToDiscord: boolean): string {
	if (hasPublishedAnswer) {
		return postsToDiscord
			? 'Already sent — saving edits the answer on the message that’s live in the answers channel, and on the public answers page.'
			: 'Already published — saving updates the answer on the public answers page. This AMA doesn’t post answers to Discord.';
	}

	return postsToDiscord
		? 'This question is already posted in the answers channel, but has no answer yet. Saving adds your answer to that message and publishes it to the public answers page.'
		: 'This AMA doesn’t post answers to Discord. Saving publishes this question and its answer to the public answers page.';
}
