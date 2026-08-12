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
 *   Discord message to mention. `undefined` while the AMA is still being fetched, which returns `null`
 *   (render nothing) rather than picking a side: every string below makes a definite claim about where
 *   the answer lives, so a guess flashes something false for one render.
 *
 * Extracted from `QuestionDetailPanel` so the combinations can be pinned by tests; it lives beside
 * `questionState.ts`/`userLabel.ts` for the same "plain data, no React" reason.
 */
export function answerEditorHint(hasPublishedAnswer: boolean, postsToDiscord: boolean | undefined): string | null {
	if (postsToDiscord === undefined) {
		return null;
	}

	if (hasPublishedAnswer) {
		return postsToDiscord
			? "Already sent — saving edits the answer on the message that's live in the answers channel, and on the public answers page."
			: "Already published — saving updates the answer on the public answers page. This AMA doesn't post answers to Discord.";
	}

	return postsToDiscord
		? 'This question is already posted in the answers channel, but has no answer yet. Saving adds your answer to that message and publishes it to the public answers page.'
		: "This AMA doesn't post answers to Discord. Saving publishes this question and its answer to the public answers page.";
}

/**
 * The confirm dialog shown before overwriting an answer people may already have read. Only reachable
 * when `hasPublishedAnswer` is true, so it never has to describe a first save -- the only variable is
 * where the answer currently lives.
 *
 * Unlike {@link answerEditorHint} this can't decline to render (the dialog is opening either way), so
 * the unknown case gets wording that holds whether or not there's an answers channel rather than a
 * guess. In practice it's barely reachable: the AMA has almost always resolved by the time someone
 * presses Save.
 */
export function saveConfirmCopy(postsToDiscord: boolean | undefined): { body: string; title: string } {
	if (postsToDiscord === undefined) {
		return {
			title: 'Edit a published answer?',
			body: "This answer has already gone out. Saving updates it everywhere it's currently visible - anyone who already read it will see the new text.",
		};
	}

	return postsToDiscord
		? {
				title: 'Edit a sent answer?',
				body: 'This answer has already gone out. Saving rewrites the existing message in the answers channel and updates the public answers page - anyone who already read it will see the new text.',
			}
		: {
				title: 'Edit a published answer?',
				body: 'This answer has already been published to the public answers page. Saving updates it there - anyone who already read it will see the new text.',
			};
}
