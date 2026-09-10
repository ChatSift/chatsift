import type {
	InferRouteContract,
	createUnappealableUserRoute,
	deleteUnappealableUserRoute,
	getAppealsConfigRoute,
	listUnappealableUsersRoute,
	updateAppealsConfigRoute,
} from '@chatsift/api';
import { apiFetch } from '@chatsift/web-core/api/fetch';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
