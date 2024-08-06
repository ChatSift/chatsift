import type { BotId, UserMe } from '@chatsift/shared';
import { useQuery } from '@tanstack/react-query';
import { routesInfo, type MakeOptions } from '~/data/common';
import clientSideFetcher, { APIError, clientSideErrorHandler } from '~/util/fetcher';
import { exponentialBackOff, retryWrapper } from '~/util/util';

function make<Data>({ path, queryKey }: MakeOptions) {
	function useQueryIt() {
		return useQuery<Data | null>({
			queryKey,
			queryFn: clientSideFetcher({ path, method: 'GET' }),
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

export const client = {
	useMe: make<UserMe>(routesInfo.me),
	useBots: make<readonly BotId[]>(routesInfo.bots),
	useBot: (bot: BotId) => make<BotId>(routesInfo.bots.bot(bot))(),
} as const;
