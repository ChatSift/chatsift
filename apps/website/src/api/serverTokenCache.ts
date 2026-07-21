/**
 * Server-side (Node.js process) cache of refresh_token -> access_token.
 *
 * Motivation: on SSR, if we already have a valid access token for the requesting session, we can send it as
 * `Authorization` directly instead of relying on the API to do a refresh-token round trip on every request.
 * If the cached token is stale, the API returns 401 and the caller clears the entry — no correctness issue,
 * just one extra request.
 *
 * globalThis trick: survives Next.js Fast Refresh in development, which re-evaluates modules but does not
 * restart the Node process.
 */

declare global {
	// eslint-disable-next-line vars-on-top
	var __chatsift_token_cache: Map<string, string> | undefined;
	// eslint-disable-next-line vars-on-top
	var __chatsift_token_cache_timeouts: Map<string, NodeJS.Timeout> | undefined;
}

globalThis.__chatsift_token_cache ??= new Map();
globalThis.__chatsift_token_cache_timeouts ??= new Map();

const tokenCache = globalThis.__chatsift_token_cache;
const tokenCacheTimeouts = globalThis.__chatsift_token_cache_timeouts;

/**
 * Matches the access token's own JWT expiry (`createAccessToken` in the API signs it for 5 minutes) — past
 * that point the cached value would be rejected as expired anyway, so it's both correct and necessary to evict
 * it proactively: an abandoned session (no further requests) never gets a `noop` response to clear it via
 * `clearCachedAccessToken`, so without a TTL its entry would sit in this process-lifetime Map forever.
 */
const TOKEN_CACHE_TTL = 5 * 60 * 1_000;

export function getCachedAccessToken(refreshToken: string): string | null {
	return tokenCache.get(refreshToken) ?? null;
}

export function setCachedAccessToken(refreshToken: string, accessToken: string): void {
	tokenCache.set(refreshToken, accessToken);

	const existingTimeout = tokenCacheTimeouts.get(refreshToken);
	if (existingTimeout) {
		existingTimeout.refresh();
		return;
	}

	// unref so a lingering entry can never keep the process alive on its own
	tokenCacheTimeouts.set(refreshToken, setTimeout(() => clearCachedAccessToken(refreshToken), TOKEN_CACHE_TTL).unref());
}

export function clearCachedAccessToken(refreshToken: string): void {
	tokenCache.delete(refreshToken);

	const timeout = tokenCacheTimeouts.get(refreshToken);
	if (timeout) {
		clearTimeout(timeout);
		tokenCacheTimeouts.delete(refreshToken);
	}
}
