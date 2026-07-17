import { isServer, QueryCache, QueryClient } from '@tanstack/react-query';
import { APIError } from './error';

export function makeQueryClient(): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			// TODO: Handle in some way
			onError: (error) => {
				if (error instanceof APIError) {
					console.error('Query error:', { statusCode: error.statusCode, error: error.error, message: error.message });
				} else {
					console.error('Network error:', error);
				}
			},
		}),
		defaultOptions: {
			queries: {
				staleTime: 60 * 1_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) => {
					if (error instanceof APIError && error.isClientError()) return false;
					return failureCount < 2;
				},
			},
			mutations: {
				retry: false,
			},
		},
	});
}

let _browserQueryClient: QueryClient | undefined;

/**
 * For use in "use client" Providers — returns a singleton on the browser, and a fresh instance on each SSR
 * pass (to avoid cross-request state sharing).
 */
export function getBrowserQueryClient(): QueryClient {
	if (isServer) {
		return makeQueryClient();
	}

	return (_browserQueryClient ??= makeQueryClient());
}

/**
 * Hierarchical query keys.
 * Use the `.all` arrays for broad invalidation, and the more specific helpers for individual cache entries.
 */
export const queryKeys = {
	all: ['api'] as const,
	auth: {
		all: ['api', 'auth'] as const,
		me: ['api', 'auth', 'me'] as const,
	},
	guilds: {
		info: (guildId: string, forBot: string) => ['api', 'guilds', guildId, 'info', forBot] as const,
	},
	grants: {
		all: (guildId: string) => ['api', 'grants', guildId] as const,
	},
	ama: {
		all: (guildId: string) => ['api', 'ama', guildId] as const,
		list: (guildId: string, includeEnded: boolean) => ['api', 'ama', guildId, 'list', includeEnded] as const,
		byId: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId] as const,
	},
} as const;
