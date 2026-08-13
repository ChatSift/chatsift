import { Buffer } from 'node:buffer';
import { expect, test, vi } from 'vitest';
import { createRestCache, describeRestKey, resolveRestKey } from '../rests.js';

const APPLICATION_ID = '1005791929075769344';
const TOKEN = `Bot ${Buffer.from(APPLICATION_ID).toString('base64')}.abcdef.ghijkl`;
const OTHER_TOKEN = `Bot ${Buffer.from('1425493115053019319').toString('base64')}.mnopqr.stuvwx`;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

test('each bot token is isolated, since Discord scopes rate limits to the token', () => {
	expect(resolveRestKey(TOKEN)).toBe(TOKEN);
	expect(resolveRestKey(OTHER_TOKEN)).not.toBe(resolveRestKey(TOKEN));
});

test('everything without a bot token shares one accountant', () => {
	// Bearer especially: keying on it would mean one `REST` instance per dashboard visitor, forever.
	expect(resolveRestKey('Bearer some-user-access-token')).toBe(resolveRestKey(undefined));
	expect(resolveRestKey('Bearer another-user-access-token')).toBe(resolveRestKey(undefined));
	// Webhook execution and interaction callbacks, which carry no `Authorization` at all.
	expect(resolveRestKey(undefined)).toBe(resolveRestKey(''));
});

test('describeRestKey names a token by its application id and never leaks the token', () => {
	expect(describeRestKey(TOKEN)).toBe(APPLICATION_ID);
	// The secret half of the token must never reach a log line.
	expect(describeRestKey(TOKEN)).not.toContain('abcdef');
	expect(describeRestKey(TOKEN)).not.toContain('ghijkl');
	expect(describeRestKey(resolveRestKey(undefined))).toBe('pooled');
	expect(describeRestKey('Bot not-a-real-token')).toBe('unknown');
});

test('the cache hands back one REST per token and reuses it', () => {
	const cache = createRestCache(logger);

	const first = cache.forAuthorization(TOKEN);
	expect(cache.forAuthorization(TOKEN)).toBe(first);
	expect(cache.size).toBe(1);

	expect(cache.forAuthorization(OTHER_TOKEN)).not.toBe(first);
	expect(cache.size).toBe(2);
});

test('the cache stays bounded no matter how many user tokens arrive', () => {
	const cache = createRestCache(logger);

	for (let index = 0; index < 100; index++) {
		cache.forAuthorization(`Bearer user-token-${index}`);
	}

	cache.forAuthorization(undefined);

	expect(cache.size).toBe(1);
});
