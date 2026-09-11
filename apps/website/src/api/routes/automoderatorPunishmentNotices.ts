import type { InferRouteContract, getPunishmentNoticesRoute, setPunishmentNoticesRoute } from '@chatsift/api';
import type { punishmentNoticeScopeSchema } from '@chatsift/api/automoderator-schemas';
import { apiFetch } from '@chatsift/web-core/api/fetch';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryClient';

type GetContract = InferRouteContract<typeof getPunishmentNoticesRoute>;
export type AutomoderatorPunishmentNotices = GetContract['response'];

type SetContract = InferRouteContract<typeof setPunishmentNoticesRoute>;
export type SetAutomoderatorPunishmentNoticesBody = SetContract['body'];

export type PunishmentNoticeScope = (typeof punishmentNoticeScopeSchema.options)[number];

export function useAutomoderatorPunishmentNotices(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.punishmentNotices(guildId),
		queryFn: async () =>
			apiFetch<AutomoderatorPunishmentNotices>('get', `/v3/guilds/${guildId}/automoderator/punishment-notices`),
	});
}

export function useSetAutomoderatorPunishmentNotices(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: SetAutomoderatorPunishmentNoticesBody) =>
			apiFetch<AutomoderatorPunishmentNotices>('put', `/v3/guilds/${guildId}/automoderator/punishment-notices`, {
				body,
			}),
		onSuccess(data) {
			queryClient.setQueryData(queryKeys.automoderator.punishmentNotices(guildId), data);
		},
	});
}
