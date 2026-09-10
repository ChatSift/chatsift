import { URL } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';

/**
 * Paths a dashboard login may return to. `/dashboard` is the whole dashboard; `/automoderator/report` is the
 * DM-report confirmation page (P3b), which is the first surface outside the dashboard that has to send an
 * anonymous visitor through OAuth and land them back where they were.
 *
 * An allowlist of prefixes rather than "any same-origin path" on purpose: the point of this function is that
 * the set of places a login can be bounced to is small and enumerated, and widening it to the whole site would
 * turn every future public page into an open-redirect target by default.
 */
const ALLOWED_PREFIXES = ['/dashboard', '/automoderator/report'];

/**
 * `unban.app`'s equivalent (#232 P3). Three entries rather than two because an appellant can be sent through
 * login from any of the site's three real surfaces: the landing page, a guild's appeal page, and their own
 * status list.
 *
 * `/<inviteCode>` is deliberately **not** here even though it is a real route. It exists only to resolve an
 * invite and bounce onward to `/g/<guildId>`, so nothing ever needs to return to it -- and leaving it out is
 * what keeps this list a short enumeration rather than "the whole site", which on a catch-all root route is the
 * same thing.
 */
const APPEALS_ALLOWED_PREFIXES = ['/', '/g', '/appeals'];

function sanitize(
	redirectTo: string | undefined,
	frontendUrl: string,
	allowedPrefixes: string[],
	fallback: string,
	logger: Logger,
): string {
	if (!redirectTo) {
		return fallback;
	}

	const frontend = new URL(frontendUrl);

	let parsed: URL;
	try {
		parsed = new URL(redirectTo, frontend);
	} catch {
		logger.warn({ redirectTo }, 'received unparsable redirect_to, falling back to default');
		return fallback;
	}

	// The trailing-slash half of each check is what stops `/dashboardevil` passing as `/dashboard`. `'/'` is
	// exact-match only for the same reason spelled the other way round: it is a prefix of literally every path,
	// so treating it as one would silently turn this allowlist into "any same-origin path".
	const isAllowedPath = allowedPrefixes.some(
		(prefix) => parsed.pathname === prefix || (prefix !== '/' && parsed.pathname.startsWith(`${prefix}/`)),
	);
	if (parsed.origin !== frontend.origin || !isAllowedPath) {
		logger.warn({ redirectTo }, 'received redirect_to outside of the allowed origin/paths, falling back to default');
		return fallback;
	}

	// Only the parts derived from `frontend` (a trusted, server-side value) plus the parsed path/query/hash are
	// ever used -- never the raw input string, and never `parsed.origin`.
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Resolves a caller-supplied `redirect_to` into a safe, same-origin path under one of {@link ALLOWED_PREFIXES}
 * -- falls back to `fallback` (default `/dashboard`) for anything that doesn't resolve to the frontend's own
 * origin, or that resolves but escapes those prefixes. Resolving via `new URL(input, frontend)` and comparing
 * `.origin` uses the real WHATWG URL parser to normalize away open-redirect tricks (protocol-relative
 * `//evil.com`, absolute `https://evil.com`, backslash tricks, encoded hosts, ...) rather than hand-rolling a
 * regex for each one.
 */
export function sanitizeRedirectTo(redirectTo: string | undefined, logger: Logger, fallback = '/dashboard'): string {
	return sanitize(redirectTo, getContext().FRONTEND_URL, ALLOWED_PREFIXES, fallback, logger);
}

/**
 * {@link sanitizeRedirectTo} against `unban.app`'s origin and {@link APPEALS_ALLOWED_PREFIXES}.
 *
 * A second entry point rather than an `origin` parameter on the one above: which frontend a given auth route
 * belongs to is fixed at the route, never at the request, and a shared function taking the origin as an
 * argument is one a future route can be handed the wrong value for -- which here would mean bouncing a
 * dashboard login onto `unban.app`, or an appellant onto the dashboard.
 */
export function sanitizeAppealsRedirectTo(redirectTo: string | undefined, logger: Logger, fallback = '/'): string {
	return sanitize(redirectTo, getContext().APPEALS_FRONTEND_URL, APPEALS_ALLOWED_PREFIXES, fallback, logger);
}
