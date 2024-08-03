import { useQuery } from '@tanstack/react-query';
import type { Snowflake } from 'discord-api-types/v10';
import fetcher, { APIError, fetcherErrorHandler } from '~/util/fetcher';
import { exponentialBackOff, retryWrapper } from '~/util/util';

type BotId = 'automoderator';

export interface CurrentUserResult {
	avatar: string | null;
	guilds: {
		bots: BotId[];
		icon: string | null;
		id: Snowflake;
		name: string;
	}[];
	id: Snowflake;
	username: string;
}

export function useUser() {
	return useQuery<CurrentUserResult>({
		queryKey: ['currentUser'],
		queryFn: fetcher({ path: '/auth/discord/@me', method: 'GET' }),
		throwOnError: fetcherErrorHandler({ throwOverride: false }),
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
