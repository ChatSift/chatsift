import { isServer, QueryCache, QueryClient } from '@tanstack/react-query';
import { APIError } from './error';
import { pushErrorBanner } from './errorBanner';

export function makeQueryClient(): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				if (error instanceof APIError) {
					console.error('Query error:', { statusCode: error.statusCode, error: error.error, message: error.message });

					// 401s mean the session expired — `NavGateProvider` already redirects to Discord OAuth off the same
					// error, so a banner here would just flash right before that navigation happens.
					if (error.statusCode === 401) {
						return;
					}
				} else {
					console.error('Network error:', error);
				}

				// Only bother the user for a *background* refetch failure (stale data is still on screen, and they'd
				// otherwise have no idea the refresh silently failed). A first-load failure (no cached data yet) is
				// already surfaced in-place by whichever component renders `UserErrorHandler` for that query's `error`.
				if (query.state.data !== undefined) {
					pushErrorBanner(error instanceof APIError ? error.message : 'Something went wrong. Please try again.');
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
		/**
		 * Separate cache entry for the one-time grant-token flow (`/dashboard/:guildId/ama/amas/new?token=...`) --
		 * keyed by the token itself so it can never collide with (or be mistaken for) the real session's `me` entry.
		 */
		meGrant: (token: string) => ['api', 'auth', 'me', 'grant', token] as const,
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
		stats: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId, 'stats'] as const,
	},
	modmail: {
		all: (guildId: string) => ['api', 'modmail', guildId] as const,
		config: (guildId: string) => ['api', 'modmail', guildId, 'config'] as const,
		categories: (guildId: string) => ['api', 'modmail', guildId, 'categories'] as const,
		panels: (guildId: string) => ['api', 'modmail', guildId, 'panels'] as const,
		snippets: (guildId: string) => ['api', 'modmail', guildId, 'snippets'] as const,
		blocks: (guildId: string) => ['api', 'modmail', guildId, 'blocks'] as const,
		threads: {
			all: (guildId: string) => ['api', 'modmail', guildId, 'threads'] as const,
			list: (guildId: string, includeClosed: boolean) =>
				['api', 'modmail', guildId, 'threads', 'list', includeClosed] as const,
			byId: (guildId: string, threadId: string) => ['api', 'modmail', guildId, 'threads', threadId] as const,
		},
	},
} as const;
