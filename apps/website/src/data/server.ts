import type { GetAMAsQuery, InferAPIRouteResult } from '@chatsift/api';
import { NewAccessTokenHeader } from '@chatsift/core';
import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { parse } from 'cookie';
import { headers } from 'next/headers';
import type { GettableRoutes, MakeOptions } from './common';
import { routesInfo } from './common';

// If multiple prefetches happen on the server, we might benefit from caching the access token
const accessTokenCache = new Map<string, string | null>();

interface FetchItResult<Data> {
	accessToken: string | null;
	data: Data | null;
	setCookieHeader: string | null;
}

function make<Options extends MakeOptions & { path: GettableRoutes }>({ path, queryKey, params }: Options) {
	const finalPath = params
		? (Object.entries(params) as [string, string][]).reduce<string>(
				(acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value)),
				path,
			)
		: path;

	async function fetchIt(): Promise<FetchItResult<InferAPIRouteResult<Options['path'], 'GET'>>> {
		const cookie = (await headers()).get('cookie') ?? '';

		const reqHeaders: HeadersInit = {
			cookie,
		};

		const refreshToken = parse(cookie)['refresh_token'];
		const cachedAccessToken = refreshToken ? (accessTokenCache.get(refreshToken) ?? null) : null;
		if (cachedAccessToken) {
			// eslint-disable-next-line @typescript-eslint/dot-notation
			reqHeaders['authorization'] = cachedAccessToken;
		}

		const res = await fetch(`${process.env['NEXT_PUBLIC_API_URL']}${finalPath}`, {
			credentials: 'include',
			headers: reqHeaders,
		});

		const newAccessToken = res.headers.get(NewAccessTokenHeader);
		if (newAccessToken && refreshToken) {
			accessTokenCache.set(refreshToken, newAccessToken === 'noop' ? null : newAccessToken);
		}

		const base = {
			accessToken: newAccessToken,
			setCookieHeader: res.headers.get('set-cookie'),
		};

		if (!res.ok) {
			if (res.status === 401) {
				return { ...base, data: null };
			}

			throw new Error('Failed to fetch');
		}

		const data = (await res.json()) as InferAPIRouteResult<Options['path'], 'GET'>;
		return {
			...base,
			data,
		};
	}

	async function prefetchNoDehydrate(client: QueryClient): Promise<void> {
		await client.prefetchQuery({
			queryKey,
			queryFn: async () => fetchIt().then((res) => res.data),
		});
	}

	async function prefetch(): Promise<DehydratedState> {
		const client = new QueryClient();
		await prefetchNoDehydrate(client);

		return dehydrate(client);
	}

	return {
		// Sometimes we need the clean fetch function to be used on the server. prefetch just calls onto it
		// and runs dehydration.
		fetch: fetchIt,
		// Used for prefetchMany
		prefetchNoDehydrate,
		prefetch,
	};
}

export const server = {
	prefetchMany: async (
		queries: { prefetchNoDehydrate(client: QueryClient): Promise<void> }[],
	): Promise<DehydratedState> => {
		const client = new QueryClient();
		const calls = queries.map(async ({ prefetchNoDehydrate }) => prefetchNoDehydrate(client));

		await Promise.all(calls);
		return dehydrate(client);
	},

	auth: {
		me: make(routesInfo.auth.me({ force_fresh: false })),
	},

	guilds: (guildId: string) => ({
		ama: {
			amas: (query: GetAMAsQuery) => make(routesInfo.guilds(guildId).ama.amas(query)),
		},
	}),
} as const;
