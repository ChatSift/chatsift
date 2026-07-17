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
}

globalThis.__chatsift_token_cache ??= new Map();
const tokenCache = globalThis.__chatsift_token_cache;

export function getCachedAccessToken(refreshToken: string): string | null {
	return tokenCache.get(refreshToken) ?? null;
}

export function setCachedAccessToken(refreshToken: string, accessToken: string): void {
	tokenCache.set(refreshToken, accessToken);
}

export function clearCachedAccessToken(refreshToken: string): void {
	tokenCache.delete(refreshToken);
}
