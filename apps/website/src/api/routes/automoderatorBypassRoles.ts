import type { InferRouteContract, listBypassRolesRoute, setBypassRoleRoute } from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListContract = InferRouteContract<typeof listBypassRolesRoute>;
export type AutomoderatorBypassRoles = ListContract['response'];
export type AutomoderatorBypassRole = AutomoderatorBypassRoles[number];

type SetContract = InferRouteContract<typeof setBypassRoleRoute>;
export type SetAutomoderatorBypassRoleResult = SetContract['response'];

export function useAutomoderatorBypassRoles(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.bypassRoles(guildId),
		queryFn: async () => apiFetch<AutomoderatorBypassRoles>('get', `/v3/guilds/${guildId}/automoderator/bypass-roles`),
	});
}

export function useSetAutomoderatorBypassRole(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// Body-less, same as the log-exemption pair: the role *is* the row, so the id in the path is the whole
		// request, and `PUT` makes re-adding one already listed a no-op rather than a conflict.
		mutationFn: async (roleId: string) =>
			apiFetch<SetAutomoderatorBypassRoleResult>('put', `/v3/guilds/${guildId}/automoderator/bypass-roles/${roleId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.bypassRoles(guildId) });
		},
	});
}

export function useDeleteAutomoderatorBypassRole(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (roleId: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/bypass-roles/${roleId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.bypassRoles(guildId) });
		},
	});
}
