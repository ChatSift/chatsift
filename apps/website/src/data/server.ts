import type { BotId, UserMe } from '@chatsift/shared';
import { dehydrate, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { routesInfo, type MakeOptions } from '~/data/common';

function make<Data>({ queryKey, path }: MakeOptions) {
	async function fetchIt(): Promise<Data | null> {
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
			throw new Error('Failed to fetch');
		}

		return res.json();
	}

	async function prefetch(): Promise<DehydratedState> {
		const client = new QueryClient();

		await client.prefetchQuery({
			queryKey,
			queryFn: fetchIt,
		});

		return dehydrate(client);
	}

	return {
		// Sometimes we need the clean fetch function to be used on the server. prefetch just call onto it
		// and runs dehydration.
		fetch: fetchIt,
		prefetch,
	};
}

export const server = {
	me: make<UserMe>(routesInfo.me),
	bots: make<readonly BotId[]>(routesInfo.bots),
	bot: (bot: BotId) => make<BotId>(routesInfo.bots.bot(bot)),

	prefetchMany: async (options: readonly MakeOptions[]): Promise<DehydratedState> => {
		const client = new QueryClient();
		const calls = options.map(async (option) => client.prefetchQuery(option));

		await Promise.all(calls);
		return dehydrate(client);
	},
} as const;
