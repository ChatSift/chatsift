import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, expect, test, vi } from 'vitest';
import {
	claimDashboardLinkToken,
	createDashboardLinkToken,
	isDashboardSessionLive,
	revokeDashboardSession,
	revokeDashboardSessionsFor,
	startDashboardSession,
	verifyDashboardLinkToken,
} from '../dashboardSession.js';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

// In-memory fake standing in for the real redis client -- just enough surface for the functions under test
// (`set` with `condition: 'NX'`/`expiration`, `exists`, `del`, `sAdd`, `sMembers`, `expire`).
const strings = new Map<string, string>();
const sets = new Map<string, Set<string>>();

const fakeRedis = {
	set: vi.fn(async (key: string, value: string, options?: { condition?: string }) => {
		if (options?.condition === 'NX' && strings.has(key)) {
			return null;
		}

		strings.set(key, value);
		return 'OK';
	}),
	exists: vi.fn(async (key: string) => (strings.has(key) ? 1 : 0)),
	del: vi.fn(async (keys: string[] | string) => {
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			strings.delete(key);
			sets.delete(key);
		}
	}),
	sAdd: vi.fn(async (key: string, member: string) => {
		const existing = sets.get(key) ?? new Set<string>();
		existing.add(member);
		sets.set(key, existing);
	}),
	sMembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
	expire: vi.fn(async () => true),
};

// Minimal `multi()` fake -- queues calls against the same handlers above and runs them in order on `.exec()`,
// enough to exercise `startDashboardSession`'s pipelined write without a real transaction.
const fakeMulti = () => {
	const queue: (() => Promise<unknown>)[] = [];
	const builder = {
		set: (...args: Parameters<(typeof fakeRedis)['set']>) => {
			queue.push(async () => fakeRedis.set(...args));
			return builder;
		},
		sAdd: (...args: Parameters<(typeof fakeRedis)['sAdd']>) => {
			queue.push(async () => fakeRedis.sAdd(...args));
			return builder;
		},
		expire: (...args: Parameters<(typeof fakeRedis)['expire']>) => {
			queue.push(async () => fakeRedis.expire(...args));
			return builder;
		},
		exec: async () => {
			const results: unknown[] = [];
			for (const run of queue) {
				results.push(await run());
			}

			return results;
		},
	};

	return builder;
};

Object.assign(fakeRedis, { multi: vi.fn(fakeMulti) });

vi.mock('../context.js', () => ({
	getContext: () => ({
		env: { ENCRYPTION_KEY },
		redis: fakeRedis,
	}),
}));

beforeEach(() => {
	strings.clear();
	sets.clear();
	vi.clearAllMocks();
});

const baseData = { sub: '123456789012345678', guildId: '876543210987654321' };

test('createDashboardLinkToken produces a token verifyDashboardLinkToken accepts', () => {
	const token = createDashboardLinkToken(baseData);
	const payload = verifyDashboardLinkToken(token);

	expect(payload).not.toBeNull();
	expect(payload).toMatchObject({ kind: 'dashboard-link', sub: baseData.sub, guildId: baseData.guildId });
	expect(typeof payload!.jti).toBe('string');
});

test('verifyDashboardLinkToken returns null for an expired token', () => {
	const expired = jwt.sign(
		{ kind: 'dashboard-link', sub: baseData.sub, guildId: baseData.guildId, jti: 'x' },
		ENCRYPTION_KEY,
		{ expiresIn: -1 },
	);

	expect(verifyDashboardLinkToken(expired)).toBeNull();
});

test('verifyDashboardLinkToken returns null for a tampered token', () => {
	const token = createDashboardLinkToken(baseData);
	const tampered = `${token.slice(0, -1)}${token.at(-1) === 'a' ? 'b' : 'a'}`;

	expect(verifyDashboardLinkToken(tampered)).toBeNull();
});

test('verifyDashboardLinkToken returns null for a well-signed but non-link-shaped token (e.g. an access token)', () => {
	const accessTokenShaped = jwt.sign(
		{ kind: 'scoped', refresh: false, sub: baseData.sub, guildId: baseData.guildId },
		ENCRYPTION_KEY,
	);

	expect(verifyDashboardLinkToken(accessTokenShaped)).toBeNull();
});

test('verifyDashboardLinkToken returns null for undefined input', () => {
	expect(verifyDashboardLinkToken(undefined)).toBeNull();
});

test('verifyDashboardLinkToken returns null when sub is missing', () => {
	const noSub = jwt.sign({ kind: 'dashboard-link', guildId: baseData.guildId, jti: 'x' }, ENCRYPTION_KEY);

	expect(verifyDashboardLinkToken(noSub)).toBeNull();
});

test('claimDashboardLinkToken only lets one of two concurrent claims for the same jti succeed', async () => {
	const token = createDashboardLinkToken(baseData);
	const { jti } = verifyDashboardLinkToken(token)!;

	const [first, second] = await Promise.all([claimDashboardLinkToken(jti), claimDashboardLinkToken(jti)]);

	expect([first, second].filter(Boolean)).toHaveLength(1);
});

test('startDashboardSession makes the session live, revokeDashboardSession kills it', async () => {
	await startDashboardSession('sid-1', baseData);
	expect(await isDashboardSessionLive('sid-1')).toBe(true);

	await revokeDashboardSession('sid-1');
	expect(await isDashboardSessionLive('sid-1')).toBe(false);
});

test('revokeDashboardSessionsFor kills every session registered for that (sub, guildId), not others', async () => {
	await startDashboardSession('sid-1', baseData);
	await startDashboardSession('sid-2', baseData);
	await startDashboardSession('sid-other', { sub: 'someone-else', guildId: baseData.guildId });

	await revokeDashboardSessionsFor(baseData.sub, baseData.guildId);

	expect(await isDashboardSessionLive('sid-1')).toBe(false);
	expect(await isDashboardSessionLive('sid-2')).toBe(false);
	expect(await isDashboardSessionLive('sid-other')).toBe(true);
});
