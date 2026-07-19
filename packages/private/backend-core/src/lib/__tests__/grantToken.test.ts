import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, expect, test, vi } from 'vitest';
import { claimGrantToken, createGrantToken, GRANTS, releaseGrantToken, verifyGrantToken } from '../grantToken.js';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

// In-memory fake standing in for the real redis client, just enough surface for
// `claimGrantToken`/`releaseGrantToken` (`set` with `condition: 'NX'` + `del`).
const fakeRedisStore = new Map<string, string>();
const fakeRedis = {
	set: vi.fn(async (key: string, value: string, options?: { condition?: string }) => {
		if (options?.condition === 'NX' && fakeRedisStore.has(key)) {
			return null;
		}

		fakeRedisStore.set(key, value);
		return 'OK';
	}),
	del: vi.fn(async (key: string) => {
		fakeRedisStore.delete(key);
	}),
};

vi.mock('../context.js', () => ({
	getContext: () => ({
		env: { ENCRYPTION_KEY },
		redis: fakeRedis,
	}),
}));

beforeEach(() => {
	fakeRedisStore.clear();
	vi.clearAllMocks();
});

const baseData = { sub: '123456789012345678', guildId: '876543210987654321', grant: GRANTS.AMA_CREATE };

test('createGrantToken produces a token verifyGrantToken accepts', () => {
	const token = createGrantToken(baseData);
	const payload = verifyGrantToken(token);

	expect(payload).not.toBeNull();
	expect(payload).toMatchObject({ kind: 'grant', sub: baseData.sub, guildId: baseData.guildId, grant: baseData.grant });
	expect(typeof payload!.jti).toBe('string');
});

test('verifyGrantToken returns null for an expired token', () => {
	const expired = jwt.sign(
		{ kind: 'grant', sub: baseData.sub, guildId: baseData.guildId, grant: baseData.grant, jti: 'x' },
		ENCRYPTION_KEY,
		{ expiresIn: -1 },
	);

	expect(verifyGrantToken(expired)).toBeNull();
});

test('verifyGrantToken returns null for a tampered token', () => {
	const token = createGrantToken(baseData);
	const tampered = `${token.slice(0, -1)}${token.at(-1) === 'a' ? 'b' : 'a'}`;

	expect(verifyGrantToken(tampered)).toBeNull();
});

test('verifyGrantToken returns null for a well-signed but non-grant-shaped token (e.g. an access token)', () => {
	const accessTokenShaped = jwt.sign({ refresh: false, sub: baseData.sub, grants: { adminGuilds: [] } }, ENCRYPTION_KEY);

	expect(verifyGrantToken(accessTokenShaped)).toBeNull();
});

test('verifyGrantToken returns null for undefined input', () => {
	expect(verifyGrantToken(undefined)).toBeNull();
});

test('verifyGrantToken returns null when sub is missing', () => {
	const noSub = jwt.sign(
		{ kind: 'grant', guildId: baseData.guildId, grant: baseData.grant, jti: 'x' },
		ENCRYPTION_KEY,
	);

	expect(verifyGrantToken(noSub)).toBeNull();
});

test('claimGrantToken/releaseGrantToken track one-time use', async () => {
	const token = createGrantToken(baseData);
	const { jti } = verifyGrantToken(token)!;

	expect(await claimGrantToken(jti)).toBe(true);

	await releaseGrantToken(jti);

	expect(await claimGrantToken(jti)).toBe(true);
});

test('claimGrantToken only lets one of two concurrent claims for the same jti succeed', async () => {
	const token = createGrantToken(baseData);
	const { jti } = verifyGrantToken(token)!;

	const [first, second] = await Promise.all([claimGrantToken(jti), claimGrantToken(jti)]);

	expect([first, second].filter(Boolean)).toHaveLength(1);
});
