'use client';

import type { GetAMAsQuery, GetAuthMeQuery, InferAPIRouteResult } from '@chatsift/api';
import type { QueryClient } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GettableRoutes, MakeOptions } from './common';
import { routesInfo } from './common';
import { APIError, clientSideErrorHandler, useClientSideFetcher } from '@/utils/fetcher';
import { exponentialBackOff, retryWrapper } from '@/utils/util';

function make<Options extends MakeOptions & { path: GettableRoutes }>({ path, queryKey, params, query }: Options) {
	const substitutedParams = params
		? (Object.entries(params) as [string, string][]).reduce<string>(
				(acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value)),
				path,
			)
		: path;
	const finalPath = query ? `${substitutedParams}?${new URLSearchParams(query as any).toString()}` : substitutedParams;

	function useQueryIt() {
		// TODO: Investigate wether this is a react compiler bug or not
		// eslint-disable-next-line react-compiler/react-compiler
		'use no memo';

		const fetcher = useClientSideFetcher({ path: finalPath as `/${string}`, method: 'GET' });
		return useQuery({
			queryKey,
			queryFn: async () => fetcher() as Promise<InferAPIRouteResult<Options['path'], 'GET'> | null>,
			throwOnError: clientSideErrorHandler({ throwOverride: false }),
			refetchOnWindowFocus: false,
			retry: retryWrapper((retries, error) => {
				if (error instanceof APIError) {
					return retries < 5 && error.payload.statusCode !== 401;
				}

				return retries < 3;
			}),
			retryDelay: exponentialBackOff,
		});
	}

	return useQueryIt;
}

function makeMutation<Options extends MakeOptions, Method extends 'DELETE' | 'PATCH' | 'POST' | 'PUT'>(
	{ path }: Options,
	method: Method,
	onSuccess?: (
		queryClient: QueryClient,
		// @ts-expect-error - We can't get it to compile on the Method
		data: InferAPIRouteResult<Options['path'], Method>,
	) => Promise<unknown>,
) {
	function useMutateIt() {
		// TODO: Investigate wether this is a react compiler bug or not
		// eslint-disable-next-line react-compiler/react-compiler
		'use no memo';

		const queryClient = useQueryClient();
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

	return useMutateIt;
}

export const client = {
	auth: {
		useMe: (query?: GetAuthMeQuery) => make(routesInfo.auth.me(query ?? { force_fresh: false }))(),
		useLogout: makeMutation(routesInfo.auth.logout, 'POST', async (queryClient) => queryClient.invalidateQueries()),
	},

	guilds: {
		ama: {
			useAMAs: (guildId: string, query: GetAMAsQuery) => make(routesInfo.guilds(guildId).ama.amas(query))(),
		},
	},
} as const;
