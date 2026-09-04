import { expect, test, vi } from 'vitest';

// `isUnderMinJoinAge` is pure arithmetic, but its module reaches `backend-core` for the gate itself -- and that
// module parses the env schema at import time and throws in a unit test. Same stub as `modCommand.test.ts`.
vi.mock('@chatsift/backend-core', () => ({
	ENV: { IS_PRODUCTION: false },
	getContext: () => ({ db: () => [], service: { client: { api: {} } } }),
	publishRealtimeInvalidate: async () => undefined,
	RedisStore: class {},
}));

const { isUnderMinJoinAge } = await import('../joinGate.js');

const DISCORD_EPOCH_MS = 1_420_070_400_000;
const NOW = 1_800_000_000_000;

function accountCreated(agoMs: number): string {
	return String((BigInt(NOW - agoMs - DISCORD_EPOCH_MS) << 22n));
}

const ONE_DAY_S = 24 * 60 * 60;

test('a gate that is off lets everybody through', () => {
	expect(isUnderMinJoinAge(accountCreated(0), null, NOW)).toBe(false);
});

test('an account younger than the gate is turned away', () => {
	expect(isUnderMinJoinAge(accountCreated(60_000), ONE_DAY_S, NOW)).toBe(true);
});

test('an account older than the gate is let in', () => {
	expect(isUnderMinJoinAge(accountCreated(2 * ONE_DAY_S * 1_000), ONE_DAY_S, NOW)).toBe(false);
});

// The boundary is worth pinning: an account exactly as old as the gate has *met* the requirement, and a `<=`
// here would turn away the one account the setting says is acceptable.
test('an account exactly as old as the gate is let in', () => {
	expect(isUnderMinJoinAge(accountCreated(ONE_DAY_S * 1_000), ONE_DAY_S, NOW)).toBe(false);
});
