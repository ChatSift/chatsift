import { expect, test } from 'vitest';
import { answerEditorHint, saveConfirmCopy } from '../answerEditorCopy.js';

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

// Until the AMA resolves there's no honest thing to say -- both branches assert where the answer lives,
// so rendering either one would flash a false claim for a render.
test('nothing is claimed while the AMA is still loading', () => {
	for (const hasPublishedAnswer of [true, false]) {
		expect(answerEditorHint(hasPublishedAnswer, undefined)).toBeNull();
	}
});

test('the save confirmation names the answers channel only when there is one', () => {
	expect(saveConfirmCopy(true).body).toContain('answers channel');
	expect(saveConfirmCopy(false).body).not.toContain('answers channel');
});

// The dialog can't decline to render the way the hint can, so the unknown case has to be true either way.
test('the save confirmation stays true about an unresolved AMA', () => {
	const { body, title } = saveConfirmCopy(undefined);

	expect(body).not.toContain('answers channel');
	expect(body).not.toContain('Discord');
	expect(body).toContain('anyone who already read it');
	expect(title).toBe('Edit a published answer?');
});
