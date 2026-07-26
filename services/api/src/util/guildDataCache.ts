import type { BotId } from '@chatsift/backend-core';
import { RedisStore } from '@chatsift/backend-core';
import type { API } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { Recipe } from 'bin-rw';
import { APIMapping } from './discordAPI.js';

export interface CachedGuildFetcher<TResult> {
	fetch(guildId: string, botId: BotId, force?: boolean): Promise<TResult | null>;
}

/**
 * Generic per-(bot, guildId) redis-backed cache with request de-duplication, for any guild-scoped Discord REST
 * resource that's read far more often than it changes (channels, roles, custom emojis, ...). `fetchRaw` should
 * reject with the raw Discord error on failure -- a 403/404 is treated as "bot doesn't have (or never had) access
 * to this guild" and mapped to `null`; anything else propagates.
 *
 * Shared mechanics, factored out once three call sites needed the identical behavior:
 *  - a 5-minute TTL cache in redis (shared across every replica/restart, unlike a process-local `Map`), partitioned
 *    per `(botId, guildId)` -- the same guildId can be queried through different bots (e.g. AMA and MODMAIL both
 *    installed in one guild), and each bot has its own guild membership/permissions, so sharing one guildId-keyed
 *    entry across bots would let one bot's fetch answer for another's;
 *  - in-flight de-duplication (still in-process -- this only needs to protect a single replica from racing itself
 *    on overlapping requests for the same key before the first one has written to redis), so overlapping calls for
 *    the same (botId, guildId) -- e.g. a forced refresh landing while an earlier fetch for the same key hasn't
 *    resolved yet -- share one fetch's result instead of racing their own cache mutations against each other (a
 *    late forced-403 delete stomping a fresher success, or an old success completing after a forced invalidation);
 *  - a forced refresh that now 403/404s drops any stale cache entry instead of leaving it to answer reads until
 *    TTL expiry.
 */
interface InflightEntry<TResult> {
	// A mutable box (not a plain boolean captured at promise-creation time) so a forced caller that coalesces onto
	// an already-running non-forced fetch can still flip the *shared* fetch's behavior -- read at resolution time
	// in `fetchAndCache`, not passed by value up front. Without this, a force-refresh landing while an unrelated
	// non-forced fetch for the same key is already in flight would silently share that fetch's result and never
	// get its 403/404-clears-cache treatment, even though the caller explicitly asked for a forced refresh.
	readonly forceBox: { current: boolean };
	readonly promise: Promise<TResult | null>;
}

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

export function createCachedGuildFetcher<TResult>(
	keyPrefix: string,
	// The array-of-results value is wrapped in an `{ items }` envelope since bin-rw recipes must be object-shaped
	// (or a bare primitive) at the top level -- a raw array can't itself be a blueprint.
	recipe: Recipe<{ items: TResult }>,
	fetchRaw: (guildId: string, api: API) => Promise<TResult>,
): CachedGuildFetcher<TResult> {
	const store = new RedisStore<{ items: TResult }>({
		TTL: CACHE_TTL_MS,
		recipe,
		makeKey: (compoundKey: string) => `guilddata:${keyPrefix}:${compoundKey}`,
		storeOld: false,
	});

	const inflight = new Map<string, InflightEntry<TResult>>();

	async function fetchAndCache(
		guildId: string,
		api: API,
		forceBox: { current: boolean },
		key: string,
	): Promise<TResult | null> {
		const result = await fetchRaw(guildId, api).catch((error: unknown) => {
			if (error instanceof DiscordAPIError && (error.status === 403 || error.status === 404)) {
				return null;
			}

			throw error;
		});

		if (result === null) {
			if (forceBox.current) {
				await store.delete(key);
			}

			return null;
		}

		await store.set(key, { items: result });
		return result;
	}

	return {
		async fetch(guildId, botId, force = false) {
			const key = `${botId}:${guildId}`;

			if (!force) {
				const cached = await store.get(key);
				if (cached) {
					return cached.items;
				}
			}

			const existing = inflight.get(key);
			if (existing) {
				if (force) {
					existing.forceBox.current = true;
				}

				return existing.promise;
			}

			const forceBox = { current: force };
			const promise = (async () => {
				try {
					return await fetchAndCache(guildId, APIMapping[botId], forceBox, key);
				} finally {
					inflight.delete(key);
				}
			})();

			inflight.set(key, { forceBox, promise });
			return promise;
		},
	};
}
