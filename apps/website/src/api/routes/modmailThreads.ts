import type { InferRouteContract, getModmailThreadRoute, listModmailThreadsRoute } from '@chatsift/api';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListModmailThreadsContract = InferRouteContract<typeof listModmailThreadsRoute>;
export type ListModmailThreadsResult = ListModmailThreadsContract['response'];
export type ModmailThreadListItem = ListModmailThreadsResult['threads'][number];

type GetModmailThreadContract = InferRouteContract<typeof getModmailThreadRoute>;
export type ModmailThreadDetail = GetModmailThreadContract['response'];
export type ModmailThreadMessage = ModmailThreadDetail['messages'][number];

/**
 * First `useInfiniteQuery` usage in the repo (#261 phase 2) -- every other list in the dashboard fetches its
 * full collection in one shot, `listThreads`/`getThread` are the first paginated routes (see their `cursor`/
 * `nextCursor` contract).
 */
export function useModmailThreads(guildId: string, includeClosed: boolean, q = '') {
	return useInfiniteQuery({
		queryKey: queryKeys.modmail.threads.list(guildId, includeClosed, q),
		queryFn: async ({ pageParam }) =>
			apiFetch<ListModmailThreadsResult>('get', `/v3/guilds/${guildId}/modmail/threads`, {
				query: { include_closed: includeClosed, cursor: pageParam, q: q || undefined },
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}

/**
 * Pages forward (`direction: 'after'`) one-directionally from the oldest message -- the phase 2 UX loads the
 * start of the conversation first and "Load more" appends newer messages below it. `direction` is a no-op on
 * the first fetch (no `cursor` yet), and only starts mattering from the second page on. Jump-to-latest +
 * scroll-up-for-older (`direction: 'before'`) is a phase 3 concern once virtualization lands.
 */
export function useModmailThread(guildId: string, threadId: string) {
	return useInfiniteQuery({
		queryKey: queryKeys.modmail.threads.byId(guildId, threadId),
		queryFn: async ({ pageParam }) =>
			apiFetch<ModmailThreadDetail>('get', `/v3/guilds/${guildId}/modmail/threads/${threadId}`, {
				query: { cursor: pageParam, direction: 'after' },
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}
