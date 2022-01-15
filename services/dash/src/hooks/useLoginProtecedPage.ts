import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useUserStore } from '~/store/index';
import { useQueryMe } from '~/hooks/useQueryMe';

export function useLoginProtectedPage() {
	const { user: data } = useQueryMe();

	const user = useUserStore();
	const router = useRouter();

	useEffect(() => {
		if (data === null) {
			void router.replace('/').catch(() => null);
		}
	}, [user]);

	return user.loggedIn;
}
