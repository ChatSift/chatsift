import { isServer, QueryCache, QueryClient } from '@tanstack/react-query';
import { APIError } from './error';
import { pushErrorBanner } from './errorBanner';

/**
 * Hoisted out of `queryKeys` below purely so the `QueryCache` `onError` in `makeQueryClient` can reference it
 * without reading a `const` declared further down the file. `queryKeys.auth.me` is still how this is spelled
 * everywhere else -- it's the same tuple, not a second source of truth.
 */
const meQueryKey = ['api', 'auth', 'me'] as const;

export function makeQueryClient(): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				if (error instanceof APIError) {
					console.error('Query error:', { statusCode: error.statusCode, error: error.error, message: error.message });

					// A 401 on *any* query means the session itself is gone (every 401 the API raises comes out of
					// `isAuthed`, which clears the cookies on its way), not just that one request failing. Nothing
					// else notices on its own, though: `me.queryFn` deliberately resolves a 401 to `null` instead of
					// throwing, so the `me` entry keeps serving its cached, logged-in user — the navbar stays signed
					// in while every page-level query renders `UserErrorHandler`'s inline "Log in" button underneath
					// it, and `NavGateProvider`'s redirect never fires because it gates on `user === null`. Writing
					// that `null` here is what hands the expiry back to `NavGateProvider`. No banner either way: a
					// redirect to Discord OAuth is about to happen.
					if (error.statusCode === 401) {
						// The `me` query is excluded (it can't 401 anyway, per above) so this can never recurse, and
						// skipped on the server, where each SSR pass gets a throwaway client that nothing observes.
						if (!isServer && query.queryKey[1] !== 'auth') {
							getBrowserQueryClient().setQueryData(meQueryKey, null);
						}

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
		me: meQueryKey,
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
		tags: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId, 'tags'] as const,
		questions: {
			all: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId, 'questions'] as const,
			list: (
				guildId: string,
				amaId: string,
				states: string | undefined,
				tagId: number | undefined,
				authorId: string | undefined,
				q: string,
			) => ['api', 'ama', guildId, amaId, 'questions', 'list', states, tagId, authorId, q] as const,
			byId: (guildId: string, amaId: string, questionId: number) =>
				['api', 'ama', guildId, amaId, 'questions', questionId] as const,
		},
		publicAnswers: (shareToken: string) => ['api', 'ama', 'public', shareToken] as const,
	},
	modmail: {
		all: (guildId: string) => ['api', 'modmail', guildId] as const,
		config: (guildId: string) => ['api', 'modmail', guildId, 'config'] as const,
		categories: (guildId: string) => ['api', 'modmail', guildId, 'categories'] as const,
		panels: (guildId: string) => ['api', 'modmail', guildId, 'panels'] as const,
		snippets: (guildId: string) => ['api', 'modmail', guildId, 'snippets'] as const,
		// Deliberately nested *under* `snippets` rather than sitting beside it: invalidation matches by key
		// prefix, so every existing `snippets(guildId)` invalidation already refreshes a snippet's revision
		// history too (#324). That matters because the edit form doesn't navigate away after a save -- the
		// history panel is still on screen and has to pick up the revision that save just created.
		snippetUpdates: (guildId: string, snippetId: number) =>
			['api', 'modmail', guildId, 'snippets', snippetId, 'updates'] as const,
		blocks: (guildId: string) => ['api', 'modmail', guildId, 'blocks'] as const,
		threads: {
			all: (guildId: string) => ['api', 'modmail', guildId, 'threads'] as const,
			list: (guildId: string, includeClosed: boolean, q: string, categoryId: number | undefined) =>
				['api', 'modmail', guildId, 'threads', 'list', includeClosed, q, categoryId] as const,
			byId: (guildId: string, threadId: string) => ['api', 'modmail', guildId, 'threads', threadId] as const,
			messageEdits: (guildId: string, threadId: string, messageId: number) =>
				['api', 'modmail', guildId, 'threads', threadId, 'messages', messageId, 'edits'] as const,
		},
	},
} as const;
