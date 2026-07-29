import { URL } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';

/**
 * Resolves a caller-supplied `redirect_to` into a safe, same-origin dashboard path -- falls back to `fallback`
 * (default `/dashboard`) for anything that doesn't resolve to the frontend's own origin, or that resolves but
 * escapes `/dashboard`. Resolving via `new URL(input, frontend)` and comparing `.origin` uses the real WHATWG URL
 * parser to normalize away open-redirect tricks (protocol-relative `//evil.com`, absolute `https://evil.com`,
 * backslash tricks, encoded hosts, ...) rather than hand-rolling a regex for each one.
 */
export function sanitizeRedirectTo(redirectTo: string | undefined, logger: Logger, fallback = '/dashboard'): string {
	if (!redirectTo) {
		return fallback;
	}

	const frontend = new URL(getContext().FRONTEND_URL);

	let parsed: URL;
	try {
		parsed = new URL(redirectTo, frontend);
	} catch {
		logger.warn({ redirectTo }, 'received unparsable redirect_to, falling back to default');
		return fallback;
	}

	if (parsed.origin !== frontend.origin || !parsed.pathname.startsWith('/dashboard')) {
		logger.warn({ redirectTo }, 'received redirect_to outside of the dashboard origin/path, falling back to default');
		return fallback;
	}

	// Only the parts derived from `frontend` (a trusted, server-side value) plus the parsed path/query/hash are
	// ever used -- never the raw input string, and never `parsed.origin`.
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
