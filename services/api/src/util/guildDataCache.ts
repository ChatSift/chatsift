import { setTimeout, clearTimeout } from 'node:timers';
import type { API, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';

export interface CachedGuildFetcher<TResult> {
	clearCache(): void;
	fetch(guildId: string, api: API, force?: boolean): Promise<TResult | null>;
}

/**
 * Generic per-(API client, guildId) cache with request de-duplication, for any guild-scoped Discord REST resource
 * that's read far more often than it changes (channels, roles, custom emojis, ...). `fetchRaw` should reject with
 * the raw Discord error on failure -- a 403/404 is treated as "bot doesn't have (or never had) access to this
 * guild" and mapped to `null`; anything else propagates.
 *
 * Shared mechanics, factored out once three call sites needed the identical behavior:
 *  - a 5-minute TTL cache, partitioned per `API` client instance (not just guildId) -- the same guildId can be
 *    queried through different bots' clients (e.g. AMA and MODMAIL both installed in one guild), and each bot has
 *    its own guild membership/permissions, so sharing one guildId-keyed cache across clients would let one bot's
 *    fetch answer for another's;
 *  - in-flight de-duplication, so overlapping calls for the same (api, guildId) -- e.g. a forced refresh landing
 *    while an earlier fetch for the same key hasn't resolved yet -- share one fetch's result instead of racing
 *    their own cache mutations against each other (a late forced-403 delete stomping a fresher success, or an old
 *    success completing after a forced invalidation);
 *  - a forced refresh that now 403/404s drops any stale cache entry instead of leaving it to answer reads until
 *    TTL expiry.
 */
export function createCachedGuildFetcher<TResult>(
	fetchRaw: (guildId: string, api: API) => Promise<TResult>,
): CachedGuildFetcher<TResult> {
	const cacheByApi = new Map<API, Map<Snowflake, TResult>>();
	const timeoutsByApi = new Map<API, Map<Snowflake, NodeJS.Timeout>>();
	const inflightByApi = new Map<API, Map<Snowflake, Promise<TResult | null>>>();
	const CACHE_TTL = 5 * 60 * 1_000; // 5 minutes

	function getMapFor<TValue>(store: Map<API, Map<Snowflake, TValue>>, api: API): Map<Snowflake, TValue> {
		let map = store.get(api);
		if (!map) {
			map = new Map();
			store.set(api, map);
		}

		return map;
	}

	async function fetchAndCache(
		guildId: string,
		api: API,
		force: boolean,
		cache: Map<Snowflake, TResult>,
		timeouts: Map<Snowflake, NodeJS.Timeout>,
	): Promise<TResult | null> {
		const result = await fetchRaw(guildId, api).catch((error: unknown) => {
			if (error instanceof DiscordAPIError && (error.status === 403 || error.status === 404)) {
				return null;
			}

			throw error;
		});

		if (result === null) {
			if (force) {
				cache.delete(guildId);
				const timeout = timeouts.get(guildId);
				if (timeout) {
					clearTimeout(timeout);
					timeouts.delete(guildId);
				}
			}

			return null;
		}

		cache.set(guildId, result);
		if (timeouts.has(guildId)) {
			const timeout = timeouts.get(guildId)!;
			timeout.refresh();
		} else {
			const timeout = setTimeout(() => {
				cache.delete(guildId);
				timeouts.delete(guildId);
			}, CACHE_TTL).unref();

			timeouts.set(guildId, timeout);
		}

		return result;
	}

	return {
		async fetch(guildId, api, force = false) {
			const cache = getMapFor(cacheByApi, api);
			const timeouts = getMapFor(timeoutsByApi, api);

			if (cache.has(guildId) && !force) {
				return cache.get(guildId)!;
			}

			const inflight = getMapFor(inflightByApi, api);

			const existing = inflight.get(guildId);
			if (existing) {
				return existing;
			}

			const promise = (async () => {
				try {
					return await fetchAndCache(guildId, api, force, cache, timeouts);
				} finally {
					inflight.delete(guildId);
				}
			})();

			inflight.set(guildId, promise);
			return promise;
		},
		clearCache() {
			for (const timeouts of timeoutsByApi.values()) {
				for (const timeout of timeouts.values()) {
					clearTimeout(timeout);
				}
			}

			cacheByApi.clear();
			timeoutsByApi.clear();
		},
	};
}
