import { makeQueryClient } from '@chatsift/web-core/api/queryClient';
import { isServer, type QueryClient } from '@tanstack/react-query';

/**
 * Hoisted out of `queryKeys` below so `makeClient`'s `onUnauthorized` can reference it without reading a
 * `const` declared further down the file. `queryKeys.me` is how this is spelled everywhere else.
 */
const meQueryKey = ['api', 'me'] as const;

let _browserQueryClient: QueryClient | undefined;

/**
 * For use in "use client" Providers -- a singleton on the browser, a fresh instance on each SSR pass, so
 * nothing is shared across requests.
 */
export function getBrowserQueryClient(): QueryClient {
	if (isServer) {
		return makeClient();
	}

	return (_browserQueryClient ??= makeClient());
}

function makeClient(): QueryClient {
	return makeQueryClient({
		onUnauthorized: (query) => {
			// Same reasoning as the dashboard's version: `me.queryFn` resolves a 401 to `null` rather than
			// throwing, so without this the header would go on rendering a signed-in appellant while every page
			// under it showed a login prompt. Writing `null` here is what makes the whole app agree the session
			// is gone. `me` itself is excluded so this can never recurse.
			if (!isServer && query.queryKey[1] !== 'me') {
				getBrowserQueryClient().setQueryData(meQueryKey, null);
			}
		},
	});
}

export const queryKeys = {
	all: ['api'] as const,
	me: meQueryKey,
	guild: (guildId: string) => ['api', 'guild', guildId] as const,
	invite: (code: string) => ['api', 'invite', code] as const,
	mine: ['api', 'mine'] as const,
};
