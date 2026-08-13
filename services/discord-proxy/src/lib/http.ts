import type { IncomingMessage } from 'node:http';
import type { RouteLike } from '@discordjs/rest';

/**
 * Clients talk to us with the same absolute paths they'd send Discord (`/api/v10/guilds/:id`), but `REST`
 * wants the version-less route (`/guilds/:id`) and re-adds `/api/v{version}` itself from its own options.
 */
const API_PREFIX = /^\/api(?:\/v\d+)?/;

/**
 * Turns an inbound request path into the `RouteLike` `REST` expects. A request for the bare prefix
 * (`/api/v10`) leaves nothing behind, which isn't a `RouteLike` -- normalize it to `/` and let Discord
 * answer with its own 404 rather than inventing one here.
 */
export function parseFullRoute(pathname: string): RouteLike {
	const stripped = pathname.replace(API_PREFIX, '');
	return (stripped.startsWith('/') ? stripped : `/${stripped}`) as RouteLike;
}

/**
 * Response headers we refuse to pass back to the caller.
 *
 * The whole point of this service is that it -- not the caller -- is the one accounting for rate limits, since
 * a single bot token is used from two processes (its `services/*-bot` and `services/api`). Forwarding Discord's
 * accounting headers would let every client rebuild its own copy of bucket state from a request stream that is
 * only a fraction of what the token actually sent, which is precisely the double-counting we're removing.
 *
 * Note this only ever runs against responses that did *not* throw, i.e. 2xx: with `rejectOnRateLimit`, a 429
 * becomes a `RateLimitError` and is answered by `populateRateLimitResponse` instead, which deliberately *does*
 * re-emit two of these headers. See `responses.ts`.
 */
const STRIPPED_RESPONSE_HEADER = /^x-ratelimit/i;

export function shouldForwardResponseHeader(header: string): boolean {
	return !STRIPPED_RESPONSE_HEADER.test(header);
}

/**
 * Request headers worth forwarding upstream. Everything else (`host`, `connection`, `accept-encoding`, ...)
 * either describes the hop between the client and us rather than the one between us and Discord, or is
 * something `REST` sets for itself.
 */
export function forwardableRequestHeaders(req: IncomingMessage): Record<string, string> {
	const headers: Record<string, string> = {};

	// Destructured rather than accessed by key: `IncomingHttpHeaders` is an index signature, which tsc's
	// `noPropertyAccessFromIndexSignature` wants read with brackets and eslint's `dot-notation` wants read
	// with dots. Destructuring is the one spelling both accept.
	const { authorization, 'content-type': contentType, 'x-audit-log-reason': auditLogReason } = req.headers;

	if (contentType) {
		headers['content-type'] = contentType;
	}

	// Forwarded verbatim -- `queueRequest` is called with `auth: false` so `REST` never sets its own, which is
	// what lets one process serve every token. `rests.ts` explains how the buckets stay separate.
	if (authorization) {
		headers['authorization'] = authorization;
	}

	if (typeof auditLogReason === 'string') {
		headers['x-audit-log-reason'] = auditLogReason;
	}

	return headers;
}

/**
 * Whether to hand the inbound stream to `REST` as a request body at all.
 *
 * `@discordjs/rest`'s undici strategy resolves an async-iterable body by *buffering* it
 * (`for await (...) chunks.push(chunk)`), not by streaming, so passing a body that doesn't exist costs an
 * empty `Buffer` and an unwanted `content-length: 0` on methods that should have neither.
 */
export function hasRequestBody(req: IncomingMessage): boolean {
	const method = req.method?.toUpperCase();
	if (method === 'GET' || method === 'HEAD') {
		return false;
	}

	const { 'content-length': contentLength, 'transfer-encoding': transferEncoding } = req.headers;
	if (contentLength !== undefined) {
		return Number(contentLength) > 0;
	}

	return transferEncoding !== undefined;
}
