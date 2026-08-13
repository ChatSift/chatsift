import type { IncomingMessage } from 'node:http';
import { expect, test } from 'vitest';
import { forwardableRequestHeaders, hasRequestBody, parseFullRoute, shouldForwardResponseHeader } from '../http.js';

function fakeRequest(method: string, headers: Record<string, string>): IncomingMessage {
	return { method, headers } as IncomingMessage;
}

test('parseFullRoute strips the api prefix with or without a version', () => {
	expect(parseFullRoute('/api/v10/guilds/1425493115053019319')).toBe('/guilds/1425493115053019319');
	expect(parseFullRoute('/api/guilds/1425493115053019319')).toBe('/guilds/1425493115053019319');
	// A client on a different version still gets its route understood -- `REST` re-adds our own version.
	expect(parseFullRoute('/api/v9/guilds/1425493115053019319')).toBe('/guilds/1425493115053019319');
});

test('parseFullRoute always produces a RouteLike', () => {
	// The bare prefix leaves an empty string behind, which isn't a `/${string}`.
	expect(parseFullRoute('/api/v10')).toBe('/');
	expect(parseFullRoute('/api')).toBe('/');
	// Nothing to strip -- passed through rather than mangled.
	expect(parseFullRoute('/guilds/1425493115053019319')).toBe('/guilds/1425493115053019319');
});

test('parseFullRoute only strips a leading prefix', () => {
	expect(parseFullRoute('/channels/1425493115053019319/api/v10')).toBe('/channels/1425493115053019319/api/v10');
});

test('parseFullRoute only strips whole path segments', () => {
	// Unanchored, these would silently become `/foo/bar` and `/-docs` -- a route rewritten into a different,
	// valid-looking one rather than an obvious failure.
	expect(parseFullRoute('/apifoo/bar')).toBe('/apifoo/bar');
	expect(parseFullRoute('/api-docs')).toBe('/api-docs');
	// `v10x` is not a version segment, so only `/api` comes off.
	expect(parseFullRoute('/api/v10x/guilds/1425493115053019319')).toBe('/v10x/guilds/1425493115053019319');
});

test('every ratelimit accounting header is withheld from the caller', () => {
	for (const header of [
		'x-ratelimit-limit',
		'x-ratelimit-remaining',
		'x-ratelimit-reset',
		'x-ratelimit-reset-after',
		'x-ratelimit-bucket',
		'X-RateLimit-Global',
		'X-RATELIMIT-SCOPE',
	]) {
		expect(shouldForwardResponseHeader(header)).toBe(false);
	}

	for (const header of ['content-type', 'content-length', 'retry-after', 'date']) {
		expect(shouldForwardResponseHeader(header)).toBe(true);
	}
});

test('only the headers Discord needs are forwarded upstream', () => {
	const headers = forwardableRequestHeaders(
		fakeRequest('POST', {
			'content-type': 'application/json',
			authorization: 'Bot token',
			'x-audit-log-reason': 'because',
			host: 'discord-proxy:7005',
			connection: 'keep-alive',
			'accept-encoding': 'gzip',
		}),
	);

	expect(headers).toStrictEqual({
		'content-type': 'application/json',
		authorization: 'Bot token',
		'x-audit-log-reason': 'because',
	});
});

test('absent optional request headers are omitted rather than sent empty', () => {
	expect(forwardableRequestHeaders(fakeRequest('GET', {}))).toStrictEqual({});
});

test('hasRequestBody says no for methods that cannot carry one', () => {
	expect(hasRequestBody(fakeRequest('GET', { 'content-length': '128' }))).toBe(false);
	expect(hasRequestBody(fakeRequest('HEAD', { 'content-length': '128' }))).toBe(false);
	expect(hasRequestBody(fakeRequest('get', { 'content-length': '128' }))).toBe(false);
});

test('hasRequestBody reads content-length, then transfer-encoding', () => {
	expect(hasRequestBody(fakeRequest('POST', { 'content-length': '128' }))).toBe(true);
	// A bodyless POST -- passing the stream anyway would have `REST` buffer an empty body and set
	// `content-length: 0` on a request that shouldn't have one.
	expect(hasRequestBody(fakeRequest('POST', { 'content-length': '0' }))).toBe(false);
	expect(hasRequestBody(fakeRequest('POST', {}))).toBe(false);
	expect(hasRequestBody(fakeRequest('PATCH', { 'transfer-encoding': 'chunked' }))).toBe(true);
});
