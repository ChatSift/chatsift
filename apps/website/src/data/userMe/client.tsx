import { useQuery } from '@tanstack/react-query';
import { path, queryKey, type UserMeResult } from '~/data/userMe/common';
import clientSideFetcher, { APIError, clientSideErrorHandler } from '~/util/fetcher';
import { exponentialBackOff, retryWrapper } from '~/util/util';

export function useQueryUserMe() {
	return useQuery<UserMeResult | null>({
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
