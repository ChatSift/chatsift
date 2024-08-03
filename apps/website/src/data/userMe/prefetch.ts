import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { cookies } from 'next/headers';
import { path, queryKey } from '~/data/userMe/common';

export async function prefetchUserMe(): Promise<DehydratedState> {
	const client = new QueryClient();

	const token = cookies().get('access_token')?.value;
	await client.prefetchQuery({
		// eslint-disable-next-line @tanstack/query/exhaustive-deps
		queryKey,
		queryFn: async () => {
			if (!token) {
				return null;
			}

			const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
				headers: {
					Authorization: token,
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
