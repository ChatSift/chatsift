import { URL } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';

/**
 * Paths a login may return to. `/dashboard` is the whole dashboard; `/automoderator/report` is the DM-report
 * confirmation page (P3b), which is the first surface outside the dashboard that has to send an anonymous
 * visitor through OAuth and land them back where they were.
 *
 * An allowlist of prefixes rather than "any same-origin path" on purpose: the point of this function is that
 * the set of places a login can be bounced to is small and enumerated, and widening it to the whole site would
 * turn every future public page into an open-redirect target by default.
 */
const ALLOWED_PREFIXES = ['/dashboard', '/automoderator/report'];

/**
 * Resolves a caller-supplied `redirect_to` into a safe, same-origin path under one of {@link ALLOWED_PREFIXES}
 * -- falls back to `fallback` (default `/dashboard`) for anything that doesn't resolve to the frontend's own
 * origin, or that resolves but escapes those prefixes. Resolving via `new URL(input, frontend)` and comparing
 * `.origin` uses the real WHATWG URL parser to normalize away open-redirect tricks (protocol-relative
 * `//evil.com`, absolute `https://evil.com`, backslash tricks, encoded hosts, ...) rather than hand-rolling a
 * regex for each one.
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

	// The trailing-slash half of each check is what stops `/dashboardevil` passing as `/dashboard`.
	const isAllowedPath = ALLOWED_PREFIXES.some(
		(prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`),
	);
	if (parsed.origin !== frontend.origin || !isAllowedPath) {
		logger.warn({ redirectTo }, 'received redirect_to outside of the allowed origin/paths, falling back to default');
		return fallback;
	}

	// Only the parts derived from `frontend` (a trusted, server-side value) plus the parsed path/query/hash are
	// ever used -- never the raw input string, and never `parsed.origin`.
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
