import type {
	getModmailThreadMessageEditsRoute,
	getModmailThreadRoute,
	InferRouteContract,
	listModmailThreadsRoute,
} from '@chatsift/api';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListModmailThreadsContract = InferRouteContract<typeof listModmailThreadsRoute>;
export type ListModmailThreadsResult = ListModmailThreadsContract['response'];
export type ModmailThreadListItem = ListModmailThreadsResult['threads'][number];

type GetModmailThreadContract = InferRouteContract<typeof getModmailThreadRoute>;
export type ModmailThreadDetail = GetModmailThreadContract['response'];
export type ModmailThreadMessage = ModmailThreadDetail['messages'][number];

type GetModmailThreadMessageEditsContract = InferRouteContract<typeof getModmailThreadMessageEditsRoute>;
export type ModmailThreadMessageEditsResult = GetModmailThreadMessageEditsContract['response'];

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

interface ModmailThreadPageParam {
	cursor: number | undefined;
	direction: 'after' | 'before';
}

async function fetchModmailThreadPage(
	guildId: string,
	threadId: string,
	pageParam: ModmailThreadPageParam,
): Promise<ModmailThreadDetail> {
	return apiFetch<ModmailThreadDetail>('get', `/v3/guilds/${guildId}/modmail/threads/${threadId}`, {
		query: { cursor: pageParam.cursor, direction: pageParam.direction },
	});
}

/**
 * Bi-directional (Phase 3, #261) -- the initial fetch (`direction: 'before'`, no cursor) lands on the
 * latest page (see `getThread.ts`'s own doc comment on why no-cursor now depends on `direction`), and
 * `fetchNextPage`/`fetchPreviousPage` page forward/backward from there via the symmetric `nextCursor`/
 * `previousCursor` the API returns on every page. Phase 2 only ever paged forward from the oldest message;
 * this replaces that one-directional shape entirely rather than adding a second mode alongside it.
 */
export function useModmailThread(guildId: string, threadId: string) {
	return useInfiniteQuery({
		queryKey: queryKeys.modmail.threads.byId(guildId, threadId),
		queryFn: async ({ pageParam }) => fetchModmailThreadPage(guildId, threadId, pageParam),
		initialPageParam: { cursor: undefined, direction: 'before' } as ModmailThreadPageParam,
		getNextPageParam: (lastPage) =>
			lastPage.nextCursor === null ? undefined : ({ cursor: lastPage.nextCursor, direction: 'after' } as const),
		getPreviousPageParam: (firstPage) =>
			firstPage.previousCursor === null
				? undefined
				: ({ cursor: firstPage.previousCursor, direction: 'before' } as const),
	});
}

/**
 * Lazily fetches a recorded message's prior versions -- only enabled while the "edited" badge's popover is
 * actually open, so a page of messages nobody clicks into doesn't fetch history nobody looks at (Phase 3,
 * #261; see `getMessageEdits.ts`'s own doc comment on why this is a separate route from `getThread.ts`).
 */
export function useModmailMessageEdits(guildId: string, threadId: string, messageId: number, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.modmail.threads.messageEdits(guildId, threadId, messageId),
		queryFn: async () =>
			apiFetch<ModmailThreadMessageEditsResult>(
				'get',
				`/v3/guilds/${guildId}/modmail/threads/${threadId}/messages/${messageId}/edits`,
			),
		enabled,
	});
}
