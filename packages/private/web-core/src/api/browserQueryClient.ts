import type { QueryClient } from '@tanstack/react-query';
import { isServer } from '@tanstack/react-query';
import { makeQueryClient } from './queryClient';

function isSameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

/**
 * Builds an app's `getBrowserQueryClient`: a singleton in the browser, a throwaway instance per SSR pass so
 * nothing leaks across requests.
 *
 * The only thing an app has to supply is where its session lives in the cache. That is enough to wire the 401
 * handling too: `me`'s query function resolves a 401 to `null` rather than throwing (both apps do this, so
 * "logged out" is distinguishable from "still loading"), which means a 401 on some *other* query would
 * otherwise leave the cached, logged-in `me` entry sitting there -- the navbar stays signed in while every
 * page under it renders a login prompt. Writing `null` into that entry here is what makes the whole app agree
 * the session is gone.
 *
 * `meQueryKey` is compared exactly, so the `me` query's own failure can never recurse into resetting itself.
 * Both apps previously hand-rolled that as an index check on one segment of the key (`queryKey[1] !== 'auth'`,
 * `queryKey[1] !== 'me'`), which happened to be right for the keys they had and would quietly stop being right
 * for a key added later.
 */
export function createBrowserQueryClientAccessor(meQueryKey: readonly unknown[]): () => QueryClient {
	let browserQueryClient: QueryClient | undefined;

	function makeClient(): QueryClient {
		return makeQueryClient({
			onUnauthorized: (query) => {
				// Skipped on the server, where each SSR pass gets a throwaway client nothing observes.
				if (isServer || isSameKey(query.queryKey, meQueryKey)) {
					return;
				}

				getBrowserQueryClient().setQueryData(meQueryKey, null);
			},
		});
	}

	function getBrowserQueryClient(): QueryClient {
		if (isServer) {
			return makeClient();
		}

		return (browserQueryClient ??= makeClient());
	}

	return getBrowserQueryClient;
}
