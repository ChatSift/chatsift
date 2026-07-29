import type { Logger } from '@chatsift/backend-core';
import { expect, test, vi } from 'vitest';
import { sanitizeRedirectTo } from '../redirectTo.js';

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({ FRONTEND_URL: 'https://example.com' }),
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
