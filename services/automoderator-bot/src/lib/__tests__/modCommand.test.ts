import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ModerationResult } from '../moderation.js';

// Whatever `getLogWebhook` finds for the guild. Only `formatCaseRef` reads it, and only for a case that
// actually made it into a log.
let webhookRows: unknown[] = [];

// `describeModerationResult` is nearly pure, but its module reaches `backend-core` -- whose env schema is
// parsed at import time and throws in a unit test -- and reaches `bot-core` beyond it. Same stub as
// `reportCard.test.ts`, plus the one export `bot-core`'s session store pulls in.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ db: () => webhookRows, service: { client: { api: {} } } }),
	publishRealtimeInvalidate: async () => undefined,
	RedisStore: class {},
}));

const { describeModerationResult } = await import('../modCommand.js');

function result(
	caseId: number,
	action: string,
	suppressed: boolean,
	logMessageId: string | null = null,
): ModerationResult {
	return {
		case: { caseId, actionType: action, guildId: '1', logMessageId } as unknown as AutomoderatorCases,
		suppressed,
	};
}

beforeEach(() => {
	webhookRows = [];
});

test('a plain action names the case it filed', async () => {
	expect(await describeModerationResult(result(7, 'WARN', false), 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case #7)',
	);
});

test('a suppressed action says it did not happen', async () => {
	expect(await describeModerationResult(result(7, 'WARN', true), 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'**Dry run** — would have warned target. (case #7)',
	);
});

test('a tripped ladder step is spelled out rather than left to the mod log', async () => {
	const withLadder = { ...result(7, 'WARN', false), ladder: result(8, 'BAN', false) };

	expect(await describeModerationResult(withLadder, 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case #7)\nThat reached a warn ladder step, so they were also banned. (case #8)',
	);
});

// Both halves of one message have to agree about whether anything happened -- the ladder's own suppression is
// what decides its tense, not the warn's.
test('a suppressed ladder step is reported in the conditional', async () => {
	const withLadder = { ...result(7, 'WARN', true), ladder: result(8, 'BAN', true) };

	expect(await describeModerationResult(withLadder, 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'**Dry run** — would have warned target. (case #7)\nThat reached a warn ladder step, so they would also have been banned. (case #8)',
	);
});

// #381: the number in an ephemeral reply is the case the moderator is about to go and look up, so it links to
// the case's own mod-log message whenever the case has one.
test('links the case number to its mod-log message', async () => {
	webhookRows = [{ channelId: '2', threadId: null }];

	expect(
		await describeModerationResult(result(7, 'WARN', false, '99'), 'target', 'WARN' as AutomoderatorCaseAction),
	).toBe('Successfully warned target. (case [#7](https://discord.com/channels/1/2/99))');
});

// A mod log pointed at a thread stores the thread's *parent* in `channel_id`, because the webhook belongs to
// the parent -- so linking to that column produces a url Discord cannot resolve.
test('links into the thread when the mod log is one', async () => {
	webhookRows = [{ channelId: '2', threadId: '3' }];

	expect(
		await describeModerationResult(result(7, 'WARN', false, '99'), 'target', 'WARN' as AutomoderatorCaseAction),
	).toBe('Successfully warned target. (case [#7](https://discord.com/channels/1/3/99))');
});
