import { useQuery } from '@tanstack/react-query';
import type { APIUser, RESTGetAPICurrentUserGuildsResult } from 'discord-api-types/v10';
import { useRouter } from 'next/navigation';
import { useToast } from '~/hooks/useToast';
import fetcher, { APIError, fetcherErrorHandler } from '~/util/fetcher';

export interface APIUserWithGuilds extends APIUser {
	guilds: RESTGetAPICurrentUserGuildsResult;
}

export function useUser() {
	const router = useRouter();
	const { toast } = useToast();

	return useQuery<APIUserWithGuilds>({
		queryKey: ['currentUser'],
		queryFn: fetcher({ path: '/auth/discord/@me', method: 'GET' }),
		throwOnError: fetcherErrorHandler({ router, toast }),
		refetchOnWindowFocus: false,
		retry: (retries, error) => {
			if (error instanceof APIError) {
				return retries < 5 && error.payload.statusCode !== 401;
			}

			return retries < 2;
		},
	});
}
