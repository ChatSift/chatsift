import type { AmaQuestionState } from '@chatsift/db';
import { expect, test } from 'vitest';
import { MERGE_SOURCE_STATES, MERGE_TARGET_STATES } from '../amaMerge.js';
import { promiseAllObject } from '../promiseAllObject.js';
import { amaPublicAnswersChannel, amaQuestionsChannel } from '../realtimeChannels.js';
import { isModuleWithDefault } from '../util.js';

// kanel generates `ama_question_state` as a real TS enum but `@chatsift/db` only re-exports its *type*, so
// there's no runtime member to reference -- same one-cast-at-the-boundary trick `services/api`'s
// `routes/ama/questions/__tests__/util.test.ts` uses, rather than casting at every call site.
const state = (literal: 'APPROVED' | 'ASKED' | 'DENIED' | 'PENDING_REVIEW') => literal as AmaQuestionState;

// Merging *away* deletes the row and its live Discord message, so it's only ever safe on a question nobody
// has acted on -- widening this set is exactly how a guest's prepared answer or an already-public post gets
// silently destroyed.
test('only an untouched question can be merged away as a duplicate', () => {
	expect([...MERGE_SOURCE_STATES]).toStrictEqual(['PENDING_REVIEW']);
});

// Absorbing is non-destructive, so it stays legal right through the answer stage and after publishing (#328)
// -- but never for DENIED, which would resurrect a decision a mod already made.
test('absorbing a duplicate stays legal through APPROVED and ASKED, never DENIED', () => {
	expect(MERGE_TARGET_STATES.has(state('PENDING_REVIEW'))).toBe(true);
	expect(MERGE_TARGET_STATES.has(state('APPROVED'))).toBe(true);
	expect(MERGE_TARGET_STATES.has(state('ASKED'))).toBe(true);
	expect(MERGE_TARGET_STATES.has(state('DENIED'))).toBe(false);
	expect(MERGE_SOURCE_STATES.has(state('DENIED'))).toBe(false);
});

// The gateway's guild-wide authorization path reads the second colon-segment as a guild id, so this shape is
// load-bearing rather than cosmetic (see `services/api/src/ws/authorizeChannel.ts`).
test('the guild-scoped questions channel keeps the <domain>:<guildId>:<...> shape', () => {
	expect(amaQuestionsChannel('1425493115053019319', 7)).toBe('ama-questions:1425493115053019319:7');
	expect(amaQuestionsChannel('1425493115053019319', '7').split(':')[1]).toBe('1425493115053019319');
});

// Deliberately breaks that shape: the public answers page is unauthenticated, so putting a guild snowflake in
// a string handed to an anonymous browser would undo the id-hiding the rest of that page does for no gain.
test('the public answers channel carries no guild id', () => {
	expect(amaPublicAnswersChannel(7)).toBe('ama-public:7');
	expect(amaPublicAnswersChannel(7)).not.toContain('1425493115053019319');
});

test('promiseAllObject awaits every value and keeps the keys', async () => {
	await expect(
		promiseAllObject({
			user: Promise.resolve({ id: '1' }),
			count: Promise.resolve(3),
		}),
	).resolves.toStrictEqual({ user: { id: '1' }, count: 3 });

	await expect(promiseAllObject({})).resolves.toStrictEqual({});
});

test('promiseAllObject rejects if any value rejects', async () => {
	await expect(
		promiseAllObject({
			ok: Promise.resolve(1),
			bad: Promise.reject(new Error('boom')),
		}),
	).rejects.toThrow('boom');
});

test('isModuleWithDefault detects a default export', () => {
	expect(isModuleWithDefault({ default: 'anything' })).toBe(true);
	expect(isModuleWithDefault({ named: 'only' })).toBe(false);
	// A module *can* legitimately default-export undefined, and `'default' in mod` is what decides -- not truthiness.
	expect(isModuleWithDefault({ default: undefined })).toBe(true);
});

// Asserted as `=== false` rather than merely falsy: the `&&` chain would otherwise short-circuit on a
// nullish `mod` and return that value verbatim, contradicting the declared `boolean` type predicate.
test('isModuleWithDefault rejects anything that is not an object', () => {
	expect(isModuleWithDefault(null)).toBe(false);
	expect(isModuleWithDefault(undefined)).toBe(false);
	expect(isModuleWithDefault('not a module')).toBe(false);
	expect(isModuleWithDefault(42)).toBe(false);
});

const isString = (value: unknown): value is string => typeof value === 'string';

test('isModuleWithDefault narrows on the supplied predicate', () => {
	expect(isModuleWithDefault({ default: 'a command' }, isString)).toBe(true);
	expect(isModuleWithDefault({ default: 42 }, isString)).toBe(false);
});
