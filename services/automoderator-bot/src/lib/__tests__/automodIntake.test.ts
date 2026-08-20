import { expect, test, vi } from 'vitest';

// `automodIntake.ts` reaches half the service at import time -- the moderation pipeline, the report spine, the
// metrics registry. None of it runs for the pure classifier under test, but all of it has to import, so the two
// modules that touch the environment are stubbed.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ db: () => [], logger: { info() {}, warn() {}, error() {} } }),
	publishRealtimeInvalidate: async () => undefined,
	decrypt: (value: string) => value,
	fileReport: async () => undefined,
	getReportsChannelId: async () => null,
	ReportFailure: class ReportFailure extends Error {},
}));

vi.mock('@chatsift/bot-core', () => ({
	fetchUser: async () => null,
	getSelfId: async () => '1',
	resolveChannelChain: async () => [],
}));

const { classifyPolicyAction } = await import('../automodIntake.js');

test('the four punishing actions classify as punishments', () => {
	for (const action of ['WARN', 'MUTE', 'KICK', 'BAN'] as const) {
		expect(classifyPolicyAction(action)).toStrictEqual({ kind: 'punishment', action });
	}
});

// REPORT is not a punishment and must never reach the case-action map -- feature 30 files a report card
// instead.
test('REPORT classifies as a report, not a punishment', () => {
	expect(classifyPolicyAction('REPORT')).toStrictEqual({ kind: 'report' });
});

// The branch the compiler believes is unreachable. It is reachable in exactly one way: a migration adds a value
// to `automoderator_banword_action` and this build predates it, at which point the cast off the row produces a
// string the union never described. Without this, the map lookup returns `undefined` and that becomes the case
// action.
test('an action this build does not know about is classified as unknown, not punished', () => {
	expect(classifyPolicyAction('DELETE' as never)).toStrictEqual({ kind: 'unknown' });
});
