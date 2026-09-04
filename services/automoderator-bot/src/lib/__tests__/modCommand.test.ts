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

function result(
	caseId: number,
	action: string,
	logChannelId: string | null = null,
	logMessageId: string | null = null,
): ModerationResult {
	return {
		case: { caseId, actionType: action, guildId: '1', logMessageId } as unknown as AutomoderatorCases,
		logChannelId,
	};
}

test('a plain action names the case it filed', () => {
	expect(describeModerationResult(result(7, 'WARN'), 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case #7)',
	);
});

test('a tripped ladder step is spelled out rather than left to the mod log', () => {
	const withLadder = { ...result(7, 'WARN'), ladder: result(8, 'BAN') };

	expect(describeModerationResult(withLadder, 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case #7)\nThat reached a warn ladder step, so they were also banned. (case #8)',
	);
});

// #381: the number in an ephemeral reply is the case the moderator is about to go and look up, so it links to
// the case's own mod-log message whenever the case has one. Both halves are read off the result rather than
// looked up here -- `applyModerationAction` resolved the channel while posting that very log.
test('links each case number to its own mod-log message', () => {
	const withLadder = {
		...result(7, 'WARN', '2', '99'),
		ladder: result(8, 'BAN', '2', '100'),
	};

	expect(describeModerationResult(withLadder, 'target', 'WARN' as AutomoderatorCaseAction)).toBe(
		'Successfully warned target. (case [#7](https://discord.com/channels/1/2/99))\n' +
			'That reached a warn ladder step, so they were also banned. (case [#8](https://discord.com/channels/1/2/100))',
	);
});

// A guild with no mod log still has case numbers -- they are just not clickable.
test('falls back to a bare number when the case never reached a log', () => {
	expect(
		describeModerationResult(result(7, 'WARN', '2', null), 'target', 'WARN' as AutomoderatorCaseAction),
	).toBe('Successfully warned target. (case #7)');
});
