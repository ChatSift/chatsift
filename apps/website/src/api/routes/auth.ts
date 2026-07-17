import type { InferRouteContract, logoutRoute, meRoute } from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIError } from '../error';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';
import { store } from '../store';
import { lastExplicitLogoutAtAtom } from '../token';

type MeContract = InferRouteContract<typeof meRoute>;
export type MeResponse = MeContract['response'];
export type MeGuild = MeResponse['guilds'][number];

type LogoutContract = InferRouteContract<typeof logoutRoute>;

export const me = {
	queryKey: () => queryKeys.auth.me,
	// A 401 here means "not logged in", not a failure — resolves to `null` rather than throwing so callers can
	// tell that state apart from "still loading" (`undefined`) without needing to inspect the query's error.
	queryFn: async (forceFresh = false): Promise<MeResponse | null> => {
		try {
			return await apiFetch<MeResponse>('get', '/v3/auth/me', { query: { force_fresh: forceFresh } });
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 401) {
				return null;
			}

			throw error;
		}
	},
};

export function useMe() {
	return useQuery({
		queryKey: me.queryKey(),
		queryFn: async () => me.queryFn(false),
	});
}

/**
 * Force-revalidates `/v3/auth/me` against Discord (bypassing the API's own in-memory cache) and writes the
 * result into the shared `useMe()` cache entry, without triggering an extra fetch on mount the way giving
 * `useMe` itself a `forceFresh` flag would.
 */
export function useRefreshMe() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => me.queryFn(true),
		onSuccess(data) {
			queryClient.setQueryData(me.queryKey(), data);
		},
	});
}

export function useLogout() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => apiFetch<LogoutContract['response']>('post', '/v3/auth/logout'),
		onSuccess() {
			store.set(lastExplicitLogoutAtAtom, Date.now());

			// Set directly rather than invalidating: `removeQueries`/`invalidateQueries` only refetch queries
			// that are *actively observed*, and empirically that refetch doesn't reliably happen synchronously
			// with this callback — the Navbar's `useMe()` was observed to keep rendering the stale logged-in
			// user indefinitely. `setQueryData` notifies every observer immediately and deterministically.
			queryClient.setQueryData(me.queryKey(), null);

			// Drop everything else (grants, AMA sessions, guild info, ...) so a subsequent login as a different
			// user can't see stale data from this session. Excludes the `me` key so it doesn't clobber the
			// explicit `null` set above back to "no cache entry" (which would read as loading, not logged-out).
			queryClient.removeQueries({ predicate: (query) => query.queryKey[1] !== 'auth' });
		},
	});
}
