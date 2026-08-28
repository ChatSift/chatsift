import type { InferRouteContract, listTriggerPunishmentsRoute, setTriggerPunishmentRoute } from '@chatsift/api';
import type { triggerPunishmentActionSchema } from '@chatsift/api/automoderator-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListContract = InferRouteContract<typeof listTriggerPunishmentsRoute>;
export type AutomoderatorTriggerPunishments = ListContract['response'];
export type AutomoderatorTriggerPunishment = AutomoderatorTriggerPunishments[number];

type SetContract = InferRouteContract<typeof setTriggerPunishmentRoute>;
export type SetAutomoderatorTriggerPunishmentBody = SetContract['body'];

export type TriggerPunishmentActionName = (typeof triggerPunishmentActionSchema.options)[number];

export function useAutomoderatorTriggerPunishments(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.triggerPunishments(guildId),
		queryFn: async () =>
			apiFetch<AutomoderatorTriggerPunishments>('get', `/v3/guilds/${guildId}/automoderator/trigger-punishments`),
	});
}

export function useSetAutomoderatorTriggerPunishment(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ triggers, ...body }: SetAutomoderatorTriggerPunishmentBody & { triggers: number }) =>
			apiFetch<AutomoderatorTriggerPunishment>(
				'put',
				`/v3/guilds/${guildId}/automoderator/trigger-punishments/${triggers}`,
				{ body },
			),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.triggerPunishments(guildId) });
		},
	});
}

export function useDeleteAutomoderatorTriggerPunishment(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (triggers: number) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/trigger-punishments/${triggers}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.triggerPunishments(guildId) });
		},
	});
}
