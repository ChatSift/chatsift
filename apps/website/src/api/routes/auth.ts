import type { InferRouteContract, logoutRoute, meRoute } from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIError } from '../error';
import { pushErrorBanner } from '../errorBanner';
import { apiFetch } from '../fetch';
import { useGrantAuth } from '../grant';
import { queryKeys } from '../queryClient';
import { store } from '../store';
import { lastExplicitLogoutAtAtom } from '../token';

export const refreshMeMutationKey = ['auth', 'refreshMe'] as const;

type MeContract = InferRouteContract<typeof meRoute>;
export type MeResponse = MeContract['response'];
export type MeGuild = MeResponse['guilds'][number];

type LogoutContract = InferRouteContract<typeof logoutRoute>;

export const me = {
	queryKey: () => queryKeys.auth.me,
	// A 401 here means "not logged in", not a failure — resolves to `null` rather than throwing so callers can
	// tell that state apart from "still loading" (`undefined`) without needing to inspect the query's error.
	// `grantToken`, when passed, is sent instead of the caller's real session (see `FetchOptions.authToken`).
	queryFn: async (forceFresh = false, grantToken?: string): Promise<MeResponse | null> => {
		try {
			return await apiFetch<MeResponse>('get', '/v3/auth/me', {
				query: { force_fresh: forceFresh },
				authToken: grantToken,
			});
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 401) {
				return null;
			}

			throw error;
		}
	},
};

/**
 * Every caller (`NavGateProvider`, `GuildNav`, `DashboardCrumbs`, the Navbar user area, ...) just calls this
 * unchanged -- it internally detects the one-time grant-token flow via `useGrantAuth()` and transparently swaps
 * in a grant-scoped query (separate cache entry, token sent instead of the session) when active, so none of
 * those call sites need to know grant auth exists.
 */
export function useMe() {
	const grant = useGrantAuth();

	return useQuery({
		queryKey: grant ? queryKeys.auth.meGrant(grant.token) : me.queryKey(),
		queryFn: async () => me.queryFn(false, grant?.token),
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
		mutationKey: refreshMeMutationKey,
		mutationFn: async () => me.queryFn(true),
		onSuccess(data) {
			queryClient.setQueryData(me.queryKey(), data);
		},
		onError(error) {
			pushErrorBanner(error instanceof APIError ? error.message : 'Failed to refresh servers. Please try again.');
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
