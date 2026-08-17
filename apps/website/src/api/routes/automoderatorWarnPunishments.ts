import type {
	InferRouteContract,
	listAutomoderatorWarnPunishmentsRoute,
	setAutomoderatorWarnPunishmentRoute,
} from '@chatsift/api';
import type { warnPunishmentActionSchema } from '@chatsift/api/automoderator-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListContract = InferRouteContract<typeof listAutomoderatorWarnPunishmentsRoute>;
export type AutomoderatorWarnPunishments = ListContract['response'];
export type AutomoderatorWarnPunishment = AutomoderatorWarnPunishments[number];

type SetContract = InferRouteContract<typeof setAutomoderatorWarnPunishmentRoute>;
export type SetAutomoderatorWarnPunishmentBody = SetContract['body'];

export type WarnPunishmentActionName = (typeof warnPunishmentActionSchema.options)[number];

export function useAutomoderatorWarnPunishments(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.warnPunishments(guildId),
		queryFn: async () =>
			apiFetch<AutomoderatorWarnPunishments>('get', `/v3/guilds/${guildId}/automoderator/warn-punishments`),
	});
}

export function useSetAutomoderatorWarnPunishment(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ warns, ...body }: SetAutomoderatorWarnPunishmentBody & { warns: number }) =>
			apiFetch<AutomoderatorWarnPunishment>('put', `/v3/guilds/${guildId}/automoderator/warn-punishments/${warns}`, {
				body,
			}),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.warnPunishments(guildId) });
		},
	});
}

export function useDeleteAutomoderatorWarnPunishment(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (warns: number) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/warn-punishments/${warns}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.warnPunishments(guildId) });
		},
	});
}
