import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import { expect, test, vi } from 'vitest';
import type { ModerationResult } from '../moderation.js';

// `describeModerationResult` is pure, but its module reaches `backend-core` -- whose env schema is parsed at
// import time and throws in a unit test -- and reaches `bot-core` beyond it. Same stub as `reportCard.test.ts`,
// plus the one export `bot-core`'s session store pulls in.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ db: () => [], service: { client: { api: {} } } }),
	publishRealtimeInvalidate: async () => undefined,
	RedisStore: class {},
}));

const { describeModerationResult } = await import('../modCommand.js');

function result(caseId: number, action: string, suppressed: boolean): ModerationResult {
	return {
		case: { caseId, actionType: action } as unknown as AutomoderatorCases,
		suppressed,
	};
}

test('a plain action names the case it filed', () => {
	expect(describeModerationResult(result(7, 'WARN', false), 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case #7)',
	);
});

test('a suppressed action says it did not happen', () => {
	expect(describeModerationResult(result(7, 'WARN', true), 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'**Dry run** — would have warned target. (case #7)',
	);
});

test('a tripped ladder step is spelled out rather than left to the mod log', () => {
	const withLadder = { ...result(7, 'WARN', false), ladder: result(8, 'BAN', false) };

	expect(describeModerationResult(withLadder, 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case #7)\nThat reached a warn ladder step, so they were also banned. (case #8)',
	);
});

// Both halves of one message have to agree about whether anything happened -- the ladder's own suppression is
// what decides its tense, not the warn's.
test('a suppressed ladder step is reported in the conditional', () => {
	const withLadder = { ...result(7, 'WARN', true), ladder: result(8, 'BAN', true) };

	expect(describeModerationResult(withLadder, 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'**Dry run** — would have warned target. (case #7)\nThat reached a warn ladder step, so they would also have been banned. (case #8)',
	);
});
