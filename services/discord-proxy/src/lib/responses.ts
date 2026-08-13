import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { DiscordAPIError, HTTPError, RateLimitError, type ResponseLike } from '@discordjs/rest';
import { shouldForwardResponseHeader } from './http.js';

/**
 * Upper bound on the random delay added to every `Retry-After` we emit.
 *
 * Fail-fast means N clients refused for the same bucket all sleep the exact same `retryAfter` and wake
 * together, re-bursting into another refusal. Only two processes share a token today so the herd is small,
 * but desynchronizing them costs a few hundred milliseconds of extra wait on an already-rate-limited request.
 */
const MAX_JITTER_MS = 250;

/**
 * `Retry-After` in seconds, jittered. Split out from `populateRateLimitResponse` so the jitter is injected
 * rather than rolled internally, which keeps this deterministic under test.
 */
export function retryAfterSeconds(error: RateLimitError, jitterMs: number): number {
	return (error.timeToReset + jitterMs) / 1_000;
}

export async function populateSuccessResponse(res: ServerResponse, data: ResponseLike): Promise<void> {
	res.statusCode = data.status;

	for (const [header, value] of data.headers) {
		if (!shouldForwardResponseHeader(header)) {
			continue;
		}

		res.setHeader(header, value);
	}

	if (data.body) {
		await pipeline(data.body instanceof Readable ? data.body : Readable.fromWeb(data.body as ReadableStream), res);
	}
}

export function populateGeneralErrorResponse(res: ServerResponse, error: DiscordAPIError | HTTPError): void {
	res.statusCode = error.status;

	if ('rawError' in error) {
		res.setHeader('Content-Type', 'application/json');
		res.write(JSON.stringify(error.rawError));
	}
}

/**
 * Answers a rate limit -- ours (the bucket was already spent, nothing was sent upstream) or Discord's own 429,
 * which `rejectOnRateLimit` turns into the same error type.
 *
 * `@discordjs/proxy`'s equivalent emits only `Retry-After`, which is a real (reported) bug: the client rebuilds
 * its `RateLimitData` from `X-RateLimit-Global` and `X-RateLimit-Scope` on the way back, so dropping them makes
 * every rate limit seen through a proxy look non-global and user-scoped no matter what actually happened. That
 * matters here because those fields are the input to a caller's `rejectOnRateLimit` predicate -- a call site
 * asking "is this global?" to decide whether to give up must get a truthful answer.
 */
export function populateRateLimitResponse(res: ServerResponse, error: RateLimitError, jitterMs: number): void {
	res.statusCode = 429;
	res.setHeader('Retry-After', retryAfterSeconds(error, jitterMs));

	// Presence-gated, never `String(error.global)`: the client tests this with `.has()`, so an explicit
	// `'false'` would read as global.
	if (error.global) {
		res.setHeader('X-RateLimit-Global', 'true');
	}

	res.setHeader('X-RateLimit-Scope', error.scope);
}

export function populateAbortErrorResponse(res: ServerResponse): void {
	res.statusCode = 504;
	res.statusMessage = 'Upstream timed out';
}

/**
 * Maps a thrown `REST` error onto the response. Returns `false` for anything unrecognized so the caller can
 * decide -- we log and 500 rather than letting it escape into the server's `clientError` path.
 */
export function populateErrorResponse(res: ServerResponse, error: unknown): boolean {
	if (error instanceof RateLimitError) {
		populateRateLimitResponse(res, error, Math.random() * MAX_JITTER_MS);
	} else if (error instanceof DiscordAPIError || error instanceof HTTPError) {
		populateGeneralErrorResponse(res, error);
	} else if (error instanceof Error && error.name === 'AbortError') {
		populateAbortErrorResponse(res);
	} else {
		return false;
	}

	return true;
}
