'use client';

import { useRouter } from 'next/navigation';
import { useUser } from '~/hooks/useUser';
import { URLS } from '~/util/constants';
import { APIError } from '~/util/fetcher';

export function useLoggedInUser() {
	const state = useUser();
	const router = useRouter();

	if (state.error && state.error instanceof APIError && state.error.payload.statusCode === 401) {
		router.push(URLS.API.LOGIN);
	}

	return state;
}
