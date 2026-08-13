import type { ServerResponse } from 'node:http';
import { RateLimitError } from '@discordjs/rest';
import { expect, test } from 'vitest';
import { populateRateLimitResponse, retryAfterSeconds } from '../responses.js';

function fakeResponse() {
	const headers = new Map<string, number | string>();

	return {
		headers,
		res: {
			statusCode: 200,
			setHeader(name: string, value: number | string) {
				headers.set(name, value);
			},
		} as unknown as ServerResponse,
	};
}

function rateLimitError(overrides: Partial<ConstructorParameters<typeof RateLimitError>[0]> = {}) {
	return new RateLimitError({
		timeToReset: 2_000,
		limit: 5,
		method: 'GET',
		hash: 'abcd',
		url: 'https://discord.com/api/v10/guilds/1425493115053019319',
		route: '/guilds/:id',
		majorParameter: '1425493115053019319',
		global: false,
		retryAfter: 2_000,
		sublimitTimeout: 0,
		scope: 'user',
		...overrides,
	});
}

test('retryAfterSeconds converts to seconds and folds the jitter in', () => {
	expect(retryAfterSeconds(rateLimitError(), 0)).toBe(2);
	expect(retryAfterSeconds(rateLimitError(), 250)).toBe(2.25);
});

test('a global ratelimit is reported as global', () => {
	const { headers, res } = fakeResponse();

	populateRateLimitResponse(res, rateLimitError({ global: true, scope: 'global' }), 0);

	expect(res.statusCode).toBe(429);
	expect(headers.get('Retry-After')).toBe(2);
	expect(headers.get('X-RateLimit-Global')).toBe('true');
	expect(headers.get('X-RateLimit-Scope')).toBe('global');
});

test('a non-global ratelimit omits the header entirely rather than sending false', () => {
	const { headers, res } = fakeResponse();

	populateRateLimitResponse(res, rateLimitError({ global: false, scope: 'user' }), 0);

	// The client tests this with `.has()`, so an explicit `'false'` would read as global. This is the bug
	// `@discordjs/proxy` has in the other direction -- it drops the header even when the limit *is* global.
	expect(headers.has('X-RateLimit-Global')).toBe(false);
	expect(headers.get('X-RateLimit-Scope')).toBe('user');
});

test('scope survives the round trip so a caller can tell a shared limit apart', () => {
	const { headers, res } = fakeResponse();

	populateRateLimitResponse(res, rateLimitError({ scope: 'shared' }), 0);

	expect(headers.get('X-RateLimit-Scope')).toBe('shared');
});
