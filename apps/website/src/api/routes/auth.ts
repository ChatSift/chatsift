import type { InferRouteContract, logoutRoute, meRoute } from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIError } from '../error';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

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
		async onSuccess() {
			await queryClient.invalidateQueries();
		},
	});
}
