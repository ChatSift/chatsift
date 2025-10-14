'use client';

import type { CreateAMABody, GetAMAsQuery, GetAuthMeQuery, GetGuildQuery, InferAPIRouteResult } from '@chatsift/api';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GettableRoutes, MakeOptions } from './common';
import { routesInfo } from './common';
import { APIError, clientSideErrorHandler, useClientSideFetcher } from '@/utils/fetcher';
import { exponentialBackOff, retryWrapper } from '@/utils/util';

function buildPath(path: string, params?: Record<string, string>, query?: Record<string, any>) {
	const substitutedParams = params
		? (Object.entries(params) as [string, string][]).reduce<string>(
				(acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value)),
				path,
			)
		: path;

	return (
		query ? `${substitutedParams}?${new URLSearchParams(query as any).toString()}` : substitutedParams
	) as `/${string}`;
}

function useQueryIt<Options extends MakeOptions & { path: GettableRoutes }>(
	{ path: initialPath, queryKey, params, query }: Options,
	doForceFresh = false,
) {
	const path = buildPath(initialPath, params, query);
	const fetcher = useClientSideFetcher({ path, method: 'GET' });
	const queryClient = useQueryClient();

	const { data, isLoading, error, refetch } = useQuery({
		// Dirty method to make sure other queries that wanna pass in force_fresh don't overwrite the others'
		// queryFn (effectively causing everything to always pass it in HTTP)
		queryKey: doForceFresh ? [...queryKey, 'force_fresh'] : queryKey,
		queryFn: async () => {
			// @ts-expect-error - This won't ever compile
			const data = (await fetcher()) as Promise<InferAPIRouteResult<Options['path'], 'GET'> | null>;
			if (doForceFresh) {
				queryClient.setQueryData(queryKey, data);
			}

			return data;
		},
		throwOnError: clientSideErrorHandler({ throwOverride: false }),
		refetchOnWindowFocus: false,
		retry: retryWrapper((retries, error) => {
			if (error instanceof APIError) {
				return retries < 5 && error.payload.statusCode !== 401;
			}

			return retries < 3;
		}),
		// Prevents double requests when a refresh button of sorts exists that passes doForceFresh
		enabled: !doForceFresh,
		retryDelay: exponentialBackOff,
	});

	return { data, isLoading, error, refetch };
}

function useMutateIt<Options extends MakeOptions, Method extends 'DELETE' | 'PATCH' | 'POST' | 'PUT'>(
	{ path: initialPath, params }: Options,
	method: Method,
	onSuccess?: (
		queryClient: QueryClient,
		// @ts-expect-error - We can't get it to compile on the Method
		data: InferAPIRouteResult<Options['path'], Method>,
	) => Promise<unknown>,
) {
	const queryClient = useQueryClient();
	const path = buildPath(initialPath, params);
	const fetcher = useClientSideFetcher({ path, method });

	return useMutation<
		// @ts-expect-error - We can't get it to compile on the Method
		InferAPIRouteResult<Options['path'], Method>,
		APIError,
		// @ts-expect-error - We can't get it to compile on the Method
		Path<Options['path'], Method>
	>({
		mutationFn: fetcher,
		onSuccess: async (data) => onSuccess?.(queryClient, data),
	});
}

export const client = {
	auth: {
		useMe: (query?: GetAuthMeQuery) =>
			useQueryIt(routesInfo.auth.me(query ?? { force_fresh: 'false' }), query?.force_fresh === 'true'),
		useLogout: () =>
			useMutateIt(routesInfo.auth.logout, 'POST', async (queryClient) => queryClient.invalidateQueries()),
	},

	guilds: {
		useInfo: (guildId: string, query: GetGuildQuery) =>
			useQueryIt(routesInfo.guilds(guildId).info(query), query?.force_fresh === 'true'),

		ama: {
			useCreateAMA: (guildId: string) =>
				useMutateIt(routesInfo.guilds(guildId).ama.amas(), 'POST', async (queryClient) => {
					await queryClient.invalidateQueries({
						queryKey: ['guilds', guildId, 'ama', 'amas'],
					});
				}),
			useAMAs: (guildId: string, query: GetAMAsQuery) => useQueryIt(routesInfo.guilds(guildId).ama.amas(query)),
			useAMA: (guildId: string, amaId: string) => useQueryIt(routesInfo.guilds(guildId).ama.ama(amaId)),
			useUpdateAMA: (guildId: string, amaId: string) =>
				useMutateIt(routesInfo.guilds(guildId).ama.updateAMA(amaId), 'PATCH', async (queryClient) => {
					await queryClient.invalidateQueries({
						queryKey: ['guilds', guildId, 'ama', 'amas'],
					});
				}),
			useRepostPrompt: (guildId: string, amaId: string) =>
				useMutateIt(routesInfo.guilds(guildId).ama.repostPrompt(amaId), 'POST', async (queryClient) => {
					await queryClient.invalidateQueries({
						queryKey: routesInfo.guilds(guildId).ama.ama(amaId).queryKey,
					});
				}),
		},
	},
} as const;
