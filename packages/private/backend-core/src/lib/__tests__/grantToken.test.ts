import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, expect, test, vi } from 'vitest';
import {
	consumeGrantToken,
	createGrantToken,
	GRANTS,
	isGrantConsumed,
	verifyGrantToken,
} from '../grantToken.js';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

// In-memory fake standing in for the real redis client, just enough surface for
// `isGrantConsumed`/`consumeGrantToken` (`exists` + `set`).
const fakeRedisStore = new Map<string, string>();
const fakeRedis = {
	exists: vi.fn(async (key: string) => (fakeRedisStore.has(key) ? 1 : 0)),
	set: vi.fn(async (key: string, value: string) => {
		fakeRedisStore.set(key, value);
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

test('isGrantConsumed/consumeGrantToken track one-time use', async () => {
	const token = createGrantToken(baseData);
	const { jti } = verifyGrantToken(token)!;

	expect(await isGrantConsumed(jti)).toBe(false);

	await consumeGrantToken(jti);

	expect(await isGrantConsumed(jti)).toBe(true);
});
