import type { InferRouteContract, getModmailConfigRoute, updateModmailConfigRoute } from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type GetModmailConfigContract = InferRouteContract<typeof getModmailConfigRoute>;
export type ModmailConfig = GetModmailConfigContract['response'];

type UpdateModmailConfigContract = InferRouteContract<typeof updateModmailConfigRoute>;
export type UpdateModmailConfigBody = UpdateModmailConfigContract['body'];

export function useModmailConfig(guildId: string) {
	return useQuery({
		queryKey: queryKeys.modmail.config(guildId),
		queryFn: async () => apiFetch<ModmailConfig>('get', `/v3/guilds/${guildId}/modmail/config`),
	});
}

export function useUpdateModmailConfig(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateModmailConfigBody) =>
			apiFetch<ModmailConfig>('patch', `/v3/guilds/${guildId}/modmail/config`, { body }),
		async onSuccess(data) {
			queryClient.setQueryData(queryKeys.modmail.config(guildId), data);
		},
	});
}
