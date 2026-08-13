import type { InferRouteContract, getAutomoderatorConfigRoute, updateAutomoderatorConfigRoute } from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type GetAutomoderatorConfigContract = InferRouteContract<typeof getAutomoderatorConfigRoute>;
export type AutomoderatorConfig = GetAutomoderatorConfigContract['response'];

type UpdateAutomoderatorConfigContract = InferRouteContract<typeof updateAutomoderatorConfigRoute>;
export type UpdateAutomoderatorConfigBody = UpdateAutomoderatorConfigContract['body'];

export function useAutomoderatorConfig(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.config(guildId),
		queryFn: async () => apiFetch<AutomoderatorConfig>('get', `/v3/guilds/${guildId}/automoderator/config`),
	});
}

export function useUpdateAutomoderatorConfig(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateAutomoderatorConfigBody) =>
			apiFetch<AutomoderatorConfig>('patch', `/v3/guilds/${guildId}/automoderator/config`, { body }),
		onSuccess(data) {
			queryClient.setQueryData(queryKeys.automoderator.config(guildId), data);
		},
	});
}
