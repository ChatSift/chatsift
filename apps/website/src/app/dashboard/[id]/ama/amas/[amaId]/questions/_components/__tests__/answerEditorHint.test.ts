import { expect, test } from 'vitest';
import { answerEditorHint } from '../answerEditorHint.js';

// The two no-answer-yet rows are the ones that were shipped wrong: both are reachable from the ordinary
// "review off, prepared answers off" setup, where a question is 'ASKED' from the moment it's submitted.
// Nothing there has been sent, published, or read by anyone, so the copy must not claim otherwise.

test('an answer that already went out to Discord says so', () => {
	const hint = answerEditorHint(true, true);

	expect(hint).toContain('Already sent');
	expect(hint).toContain('answers channel');
});

test('an answer already public with no Discord channel does not mention one', () => {
	const hint = answerEditorHint(true, false);

	expect(hint).toContain('Already published');
	expect(hint).not.toContain('answers channel');
});

test('an asked question with no answer yet never claims the answer is already out', () => {
	for (const postsToDiscord of [true, false]) {
		const hint = answerEditorHint(false, postsToDiscord);

		expect(hint).not.toContain('Already');
		expect(hint).toContain('Saving');
	}
});

test('a question posted to Discord but unanswered describes adding to the existing message', () => {
	const hint = answerEditorHint(false, true);

	expect(hint).toContain('already posted in the answers channel');
	expect(hint).toContain('no answer yet');
});

test('a public-page-only AMA never promises a Discord edit in any state', () => {
	for (const hasPublishedAnswer of [true, false]) {
		expect(answerEditorHint(hasPublishedAnswer, false)).not.toContain('answers channel');
	}
});
