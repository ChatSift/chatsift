import { createHash } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import { getContext } from '@chatsift/backend-core';
import type { Logger } from '@chatsift/backend-core';
import type { RESTPostOAuth2AccessTokenResult } from '@discordjs/core';
import { discordAPIOAuth } from './discordAPI.js';

/**
 * The subset of discord's token response the session layer actually stores (see `util/tokens.ts`).
 */
export type RefreshedOAuthData = Pick<RESTPostOAuth2AccessTokenResult, 'access_token' | 'expires_in' | 'refresh_token'>;

/**
 * How long a *completed* rotation stays reusable by a later caller still presenting the old refresh token.
 *
 * Deduplicating only genuinely-concurrent calls isn't enough: the browser fires several dashboard requests in
 * parallel, and the ones already in flight when the winner's `Set-Cookie` lands still carry the pre-rotation
 * refresh token. They arrive *after* the winning promise settled, so an "evict on settle" cache would let each
 * of them redeem an already-rotated token and get an `invalid_grant` back -- i.e. a logout. A short grace window
 * covers that tail without keeping credentials around meaningfully longer than the request that fetched them.
 */
const RESULT_GRACE_MS = 60 * 1_000;

// Keyed by a hash of the *old* refresh token (the one being redeemed), never the token itself -- this is an
// in-process map holding live discord credentials, and hashing keeps the key from doubling as one. Unlike
// `MeStore` in `me.ts` this is deliberately never persisted to redis: the values are a usable access/refresh
// pair, so they stay in memory and die with the process.
const pending = new Map<string, Promise<RefreshedOAuthData>>();
const evictions = new Map<string, NodeJS.Timeout>();

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function evict(key: string): void {
	pending.delete(key);

	const timeout = evictions.get(key);
	if (timeout) {
		clearTimeout(timeout);
		evictions.delete(key);
	}
}

/**
 * Redeems a discord refresh token for a fresh access/refresh pair, collapsing concurrent (and near-concurrent,
 * see `RESULT_GRACE_MS`) redemptions of the same token onto a single request to discord.
 *
 * This matters because discord rotates refresh tokens: a successful redemption invalidates the token it was
 * called with. Without this, N parallel requests carrying the same session cookie all redeem it independently,
 * exactly one wins, and the losers get `invalid_grant` -- which `isAuthed` (correctly, for a genuinely dead
 * token) turns into a forced logout. That path is reachable on any dashboard page load that happens to land in
 * the refresh window, and `isAuthed`'s stale-access-token recovery funnels into it too.
 *
 * In-process, per-replica, same as `discordApplication.ts`'s `pending` map and `discordAPI.ts`'s round-robin
 * state: the api runs as a single container today (`docker-compose.yml`), so this covers every concurrent
 * request. If it's ever replicated this degrades to per-replica coalescing rather than breaking -- the losers
 * fall back to today's behaviour, not something worse.
 */
export async function refreshDiscordAccessToken(
	discordRefreshToken: string,
	logger: Logger,
): Promise<RefreshedOAuthData> {
	const key = hashToken(discordRefreshToken);

	const existing = pending.get(key);
	if (existing) {
		logger.info('coalescing onto an in-flight or just-completed discord token refresh');
		return existing;
	}

	// Same shape as `discordApplication.ts`'s `pending` map: the map is populated synchronously (this body only
	// yields at the `await`), so a concurrent caller arriving before discord answers still finds the entry.
	const promise = (async () => {
		try {
			const rotated = await discordAPIOAuth.oauth2.refreshToken({
				// Discord authenticates the *application* on every token-endpoint grant, and `refreshToken` sends
				// `auth: false` -- so without these two in the form body the request carries no client identity at
				// all and comes back `401 invalid_client`, no matter how good the user's refresh token is. That is
				// exactly what shipped: `discord-api-types` types these as `{both} | {neither}`, so omitting them
				// typechecks, and every rotation this service ever attempted failed for that reason (#384). The
				// authorization-code exchange (`routes/auth/discordCallback.ts`) and the revocation on logout have
				// always passed them; only this call didn't.
				client_id: getContext().env.OAUTH_DISCORD_CLIENT_ID,
				client_secret: getContext().env.OAUTH_DISCORD_CLIENT_SECRET,
				grant_type: 'refresh_token',
				refresh_token: discordRefreshToken,
			});

			// The token this was keyed on is spent now, so there's no correctness risk in serving this result to
			// anyone else still presenting it -- they'd get an `invalid_grant` otherwise. Held only for the grace
			// window, then dropped so credentials don't linger for the life of the process.
			evictions.set(
				key,
				// unref so a pending eviction can never be the reason the process stays alive
				setTimeout(() => evict(key), RESULT_GRACE_MS).unref(),
			);

			return rotated;
		} catch (error) {
			// A failure says nothing about the token (a discord blip is at least as likely as `invalid_grant`), and
			// a request that never succeeded hasn't consumed the refresh token -- drop the entry immediately so the
			// next caller retries fresh instead of inheriting a cached rejection.
			evict(key);
			throw error;
		}
	})();

	pending.set(key, promise);

	return promise;
}

/**
 * Drops all coalescing state.
 *
 * For tests: the grace window above deliberately outlives the request that populated it, so without this one
 * test's rotation result gets served to the next one that happens to use the same refresh token, and the
 * discord mock never sees the call it's asserting on.
 */
export function resetDiscordOAuthRefreshCoalescing(): void {
	// Deleting the current key mid-iteration is well-defined for a `Map`, so this doesn't need a copy.
	for (const key of pending.keys()) {
		evict(key);
	}
}
