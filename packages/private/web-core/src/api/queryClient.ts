import { MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query';
import { APIError } from './error';
import { pushErrorBanner } from './errorBanner';
import { reportError } from './report';

export interface MakeQueryClientOptions {
	/**
	 * Called when a 401 reaches the `QueryCache` `onError`, meaning the session itself is gone rather than one
	 * request failing. Optional because an app with no session concept -- a public, unauthenticated page -- has
	 * nothing to do here. The dashboard uses it to write `null` into its own `me` entry, which is knowledge of a
	 * query key this package deliberately does not have.
	 */
	// Generics spelled out rather than left to default: `QueryCache`'s `onError` hands over a
	// `Query<unknown, unknown, unknown>`, while bare `Query` defaults its error type to `Error` and so
	// rejects it.
	onUnauthorized?(query: Query<unknown, unknown, unknown>): void;
}

export function makeQueryClient(options: MakeQueryClientOptions = {}): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				// Before the branching below, so it covers every query failure exactly once (#386). Routine 4xx --
				// the 401 path immediately below especially -- are dropped inside `shouldReport`, not here; the
				// policy deliberately lives in one place rather than being spread across call sites.
				reportError(error, { source: 'query', queryKey: query.queryKey });

				if (error instanceof APIError) {
					console.error('Query error:', { statusCode: error.statusCode, error: error.error, message: error.message });

					// A 401 on *any* query means the session itself is gone (every 401 the API raises comes out of
					// `isAuthed`, which clears the cookies on its way), not just that one request failing. What an app
					// should *do* about that is app-specific, so it goes out through `onUnauthorized` rather than being
					// decided here -- see `apps/website/src/api/queryClient.ts` for the dashboard's version and why it
					// has to write `null` into its own `me` entry. No banner either way: an app that handles this is
					// about to redirect.
					if (error.statusCode === 401) {
						options.onUnauthorized?.(query);

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
		// The app's first `MutationCache`, and deliberately reporting-only: no banner, no toast, no UX change
		// at all. `Button`'s catch and each form's own field-level errors already own the user-facing half, and
		// adding a second surface here would double up on every form that already handles its own failure.
		//
		// It exists because coverage was otherwise a function of how a mutation happened to be triggered --
		// `Button` is a safety net, not a guarantee, so a mutation fired from anywhere else reported nothing.
		mutationCache: new MutationCache({
			onError: (error) => {
				reportError(error, { source: 'mutation' });
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
