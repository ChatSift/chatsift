import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { path, queryKey, type UserMeResult } from '~/data/userMe/common';

export async function fetchUserMe(): Promise<UserMeResult | null> {
	const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
		credentials: 'include',
		headers: {
			cookie: headers().get('cookie') ?? '',
		},
	});

	if (res.status === 401) {
		return null;
	}

	if (!res.ok) {
		throw new Error('Failed to fetch me');
	}

	return res.json();
}

export async function prefetchUserMe(): Promise<DehydratedState> {
	const client = new QueryClient();

	await client.prefetchQuery({
		queryKey,
		queryFn: fetchUserMe,
	});

	return dehydrate(client);
}
