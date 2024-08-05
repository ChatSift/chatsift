'use client';

import { useRouter } from 'next/navigation';
import { useQueryUserMe } from '~/data/userMe/client';
import { URLS } from '~/util/constants';
import { APIError } from '~/util/fetcher';

export function useLoggedInUser() {
	const state = useQueryUserMe();
	const router = useRouter();

	if (
		(state.error && state.error instanceof APIError && state.error.payload.statusCode === 401) ||
		state.data === null
	) {
		router.push(URLS.API.LOGIN);
	}

	return state;
}
