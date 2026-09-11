import type {
	InferRouteContract,
	createUnappealableUserRoute,
	decideAppealRoute,
	deleteUnappealableUserRoute,
	getAppealRoute,
	getAppealsConfigRoute,
	listAppealsRoute,
	listUnappealableUsersRoute,
	updateAppealsConfigRoute,
} from '@chatsift/api';
import type { appealStatusSchema } from '@chatsift/api/appeals-schemas';
import { apiFetch } from '@chatsift/web-core/api/fetch';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryClient';

type GetAppealsConfigContract = InferRouteContract<typeof getAppealsConfigRoute>;
export type AppealsConfig = GetAppealsConfigContract['response'];
export type AppealQuestion = AppealsConfig['questions'][number];

type UpdateAppealsConfigContract = InferRouteContract<typeof updateAppealsConfigRoute>;
export type UpdateAppealsConfigBody = UpdateAppealsConfigContract['body'];

type ListUnappealableUsersContract = InferRouteContract<typeof listUnappealableUsersRoute>;
export type UnappealableUser = ListUnappealableUsersContract['response'][number];

type CreateUnappealableUserContract = InferRouteContract<typeof createUnappealableUserRoute>;
export type CreateUnappealableUserBody = CreateUnappealableUserContract['body'];

type DeleteUnappealableUserContract = InferRouteContract<typeof deleteUnappealableUserRoute>;
export type DeleteUnappealableUserBody = DeleteUnappealableUserContract['body'];

type ListAppealsContract = InferRouteContract<typeof listAppealsRoute>;
export type ListAppealsResult = ListAppealsContract['response'];
export type AppealListItem = ListAppealsResult['appeals'][number];

type GetAppealContract = InferRouteContract<typeof getAppealRoute>;
export type GetAppealResult = GetAppealContract['response'];
export type AppealEvent = GetAppealResult['events'][number];
export type AppealAnswer = GetAppealResult['answers'][number];

type DecideAppealContract = InferRouteContract<typeof decideAppealRoute>;
export type DecideAppealBody = DecideAppealContract['body'];
export type DecideAppealResult = DecideAppealContract['response'];

/**
 * `settings` is `null` until the guild finishes setup -- the row's existence is the signal, not a defaulted
 * shape (see `getConfig.ts`), so every consumer has to branch on it rather than reading through `?.`.
 */
export function useAppealsConfig(guildId: string) {
	return useQuery({
		queryKey: queryKeys.appeals.config(guildId),
		queryFn: async () => apiFetch<AppealsConfig>('get', `/v3/guilds/${guildId}/appeals/config`),
	});
}

export function useUpdateAppealsConfig(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateAppealsConfigBody) =>
			apiFetch<AppealsConfig>('patch', `/v3/guilds/${guildId}/appeals/config`, { body }),
		onSuccess(data) {
			queryClient.setQueryData(queryKeys.appeals.config(guildId), data);
		},
	});
}

export function useUnappealableUsers(guildId: string) {
	return useQuery({
		queryKey: queryKeys.appeals.unappealableUsers(guildId),
		queryFn: async () => apiFetch<UnappealableUser[]>('get', `/v3/guilds/${guildId}/appeals/unappealable-users`),
	});
}

/**
 * `PUT`, not `POST` -- the API upserts, so re-adding somebody already listed amends their reason instead of
 * conflicting. The list has to be refetched rather than patched from the response: the row comes back raw,
 * without the resolved account the list renders.
 */
export function useSetUnappealableUser(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateUnappealableUserBody) =>
			apiFetch('put', `/v3/guilds/${guildId}/appeals/unappealable-users`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.appeals.unappealableUsers(guildId) });
		},
	});
}

/**
 * The user id travels in the body rather than the path, matching the route -- see
 * `deleteUnappealableUser.ts`.
 */
export function useDeleteUnappealableUser(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (userId: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/appeals/unappealable-users`, { body: { userId } }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.appeals.unappealableUsers(guildId) });
		},
	});
}

/**
 * The appeal statuses, straight off the API's own zod enum -- so a filter value the route would reject can't be
 * constructed here in the first place. Same arrangement as `ReportStateName`.
 */
export type AppealStatusName = (typeof appealStatusSchema.options)[number];

export interface AppealFilters {
	status?: AppealStatusName | undefined;
	userId?: string | undefined;
}

export function useAppeals(guildId: string, filters: AppealFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.appeals.queue.list(guildId, filters),
		queryFn: async ({ pageParam }) =>
			apiFetch<ListAppealsResult>('get', `/v3/guilds/${guildId}/appeals/queue`, {
				query: { cursor: pageParam, status: filters.status, user_id: filters.userId },
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}

export function useAppeal(guildId: string, appealId: number) {
	return useQuery({
		queryKey: queryKeys.appeals.queue.byId(guildId, appealId),
		queryFn: async () => apiFetch<GetAppealResult>('get', `/v3/guilds/${guildId}/appeals/queue/${appealId}`),
	});
}

/**
 * The dashboard's half of the three buttons on the card (#232 P5).
 *
 * Invalidates the whole queue subtree rather than patching the row in: the decision changes the guild's pending
 * count and this appeal's `appeal_events` trail as well as the row itself, and the response carries only the
 * row. Every other viewer gets the same refetch through `appealsQueueChannel`, which `applyAppealDecision`
 * publishes to for both surfaces.
 */
export function useDecideAppeal(guildId: string, appealId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: DecideAppealBody) =>
			apiFetch<DecideAppealResult>('post', `/v3/guilds/${guildId}/appeals/queue/${appealId}/decision`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.appeals.queue.all(guildId) });
		},
	});
}
