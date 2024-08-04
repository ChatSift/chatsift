import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { path, queryKey } from '~/data/userMe/common';

export async function prefetchUserMe(): Promise<DehydratedState> {
	const client = new QueryClient();

	await client.prefetchQuery({
		queryKey,
		queryFn: async () => {
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
		},
	});

	return dehydrate(client);
}
