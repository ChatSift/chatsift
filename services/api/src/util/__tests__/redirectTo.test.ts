import type { Logger } from '@chatsift/backend-core';
import { expect, test, vi } from 'vitest';
import { sanitizeAppealsRedirectTo, sanitizeRedirectTo } from '../redirectTo.js';

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({ FRONTEND_URL: 'https://example.com', APPEALS_FRONTEND_URL: 'https://unban.example' }),
}));

function createMockLogger(): Logger {
	return { warn: vi.fn() } as unknown as Logger;
}

test('falls back to the default when redirectTo is undefined', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo(undefined, logger)).toBe('/dashboard');
	expect(logger.warn).not.toHaveBeenCalled();
});

test('falls back to the default when redirectTo is empty', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('', logger)).toBe('/dashboard');
	expect(logger.warn).not.toHaveBeenCalled();
});

test('accepts a same-origin dashboard path, preserving query and hash', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('/dashboard/123/modmail?tab=threads#latest', logger)).toBe(
		'/dashboard/123/modmail?tab=threads#latest',
	);
	expect(logger.warn).not.toHaveBeenCalled();
});

test('rejects an absolute URL pointing at a different origin', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('https://evil.com/dashboard', logger)).toBe('/dashboard');
	expect(logger.warn).toHaveBeenCalledOnce();
});

test('rejects a protocol-relative URL pointing at a different origin', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('//evil.com/dashboard', logger)).toBe('/dashboard');
	expect(logger.warn).toHaveBeenCalledOnce();
});

test('rejects a same-origin path outside of /dashboard', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('/etc/passwd', logger)).toBe('/dashboard');
	expect(logger.warn).toHaveBeenCalledOnce();
});

test('rejects a path that merely starts with the /dashboard string without a segment boundary', () => {
	const logger = createMockLogger();
	// '/dashboardevil'.startsWith('/dashboard') is true -- a naive prefix check would wrongly accept this.
	expect(sanitizeRedirectTo('/dashboardevil', logger)).toBe('/dashboard');
	expect(logger.warn).toHaveBeenCalledOnce();
});

test('accepts the bare /dashboard path with no trailing segment', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('/dashboard', logger)).toBe('/dashboard');
	expect(logger.warn).not.toHaveBeenCalled();
});

test('rejects a path that traverses outside of /dashboard via dot-segments', () => {
	const logger = createMockLogger();
	// `new URL` normalizes '/dashboard/../../evil' down to pathname '/evil', which no longer starts with
	// '/dashboard' -- the same prefix check that handles unrelated paths also catches this.
	expect(sanitizeRedirectTo('/dashboard/../../evil', logger)).toBe('/dashboard');
	expect(logger.warn).toHaveBeenCalledOnce();
});

test('rejects an unparsable redirectTo', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('http://[', logger)).toBe('/dashboard');
	expect(logger.warn).toHaveBeenCalledOnce();
});

test('honors a custom fallback', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('https://evil.com', logger, '/dashboard/safe')).toBe('/dashboard/safe');
});

test('allows the public DM-report confirmation page (#P3b)', () => {
	// The first surface outside `/dashboard` that has to send an anonymous visitor through OAuth and land them
	// back where they were, which is why the check became a prefix allowlist rather than one hardcoded path.
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('/automoderator/report/6f1c2d0e-0000-4000-8000-000000000000', logger)).toBe(
		'/automoderator/report/6f1c2d0e-0000-4000-8000-000000000000',
	);
	expect(logger.warn).not.toHaveBeenCalled();
});

test('a path that merely starts with an allowed prefix is still rejected', () => {
	// `/automoderatorevil` shares five characters with the allowlist and nothing else -- the same trap
	// `/dashboardevil` covers for the original prefix.
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('/automoderator/reportevil', logger)).toBe('/dashboard');
	expect(sanitizeRedirectTo('/automoderator/history/abc', logger)).toBe('/dashboard');
});

test('the report page is not a way out of the origin check', () => {
	const logger = createMockLogger();
	expect(sanitizeRedirectTo('https://evil.com/automoderator/report/x', logger)).toBe('/dashboard');
	expect(sanitizeRedirectTo('//evil.com/automoderator/report/x', logger)).toBe('/dashboard');
});

test("the appeals variant accepts unban.app's own three surfaces", () => {
	const logger = createMockLogger();
	expect(sanitizeAppealsRedirectTo('/', logger)).toBe('/');
	expect(sanitizeAppealsRedirectTo('/g/1234567890', logger)).toBe('/g/1234567890');
	expect(sanitizeAppealsRedirectTo('/appeals', logger)).toBe('/appeals');
	expect(logger.warn).not.toHaveBeenCalled();
});

test('the appeals variant does not treat its "/" entry as a prefix', () => {
	// `'/'` is a prefix of every path, so a prefix check that included it would silently accept the whole site --
	// including `/<inviteCode>`, the one route deliberately left off the allowlist.
	const logger = createMockLogger();
	expect(sanitizeAppealsRedirectTo('/some-invite-code', logger)).toBe('/');
	expect(sanitizeAppealsRedirectTo('/anything/at/all', logger)).toBe('/');
	expect(logger.warn).toHaveBeenCalledTimes(2);
});

test('the two frontends cannot redirect into one another', () => {
	// The whole point of the second entry point: an appeals login bounced onto the dashboard's origin (or the
	// reverse) would hand a session cookie's return trip to the wrong site.
	const logger = createMockLogger();
	expect(sanitizeAppealsRedirectTo('https://example.com/dashboard', logger)).toBe('/');
	expect(sanitizeRedirectTo('https://unban.example/g/123', logger)).toBe('/dashboard');
});
