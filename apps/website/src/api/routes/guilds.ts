import type { InferRouteContract, createGrantRoute, deleteGrantRoute, getGrantsRoute, getGuildRoute } from '@chatsift/api';
import type { BotId } from '@chatsift/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type GetGuildContract = InferRouteContract<typeof getGuildRoute>;
export type GuildInfo = GetGuildContract['response'];
export type GuildChannelInfo = GuildInfo['channels'][number];

type GetGrantsContract = InferRouteContract<typeof getGrantsRoute>;
export type GetGrantsResult = GetGrantsContract['response'];

type CreateGrantContract = InferRouteContract<typeof createGrantRoute>;
export type CreateGrantBody = CreateGrantContract['body'];

type DeleteGrantContract = InferRouteContract<typeof deleteGrantRoute>;
export type DeleteGrantBody = DeleteGrantContract['body'];

export function useGuildInfo(guildId: string, forBot: BotId) {
	return useQuery({
		queryKey: queryKeys.guilds.info(guildId, forBot),
		queryFn: async () =>
			apiFetch<GuildInfo>('get', `/v3/guilds/${guildId}`, { query: { for_bot: forBot, force_fresh: false } }),
	});
}

/**
 * Force-revalidates a guild's channel list against Discord and writes the result into the shared
 * `useGuildInfo()` cache entry for the same `(guildId, forBot)` pair.
 */
export function useRefreshGuildInfo(guildId: string, forBot: BotId) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<GuildInfo>('get', `/v3/guilds/${guildId}`, { query: { for_bot: forBot, force_fresh: true } }),
		onSuccess(data) {
			queryClient.setQueryData(queryKeys.guilds.info(guildId, forBot), data);
		},
	});
}

export function useGrants(guildId: string) {
	return useQuery({
		queryKey: queryKeys.grants.all(guildId),
		queryFn: async () => apiFetch<GetGrantsResult>('get', `/v3/guilds/${guildId}/grants`),
	});
}

export function useCreateGrant(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateGrantBody) =>
			apiFetch<CreateGrantContract['response']>('put', `/v3/guilds/${guildId}/grants`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.grants.all(guildId) });
		},
	});
}

export function useDeleteGrant(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: DeleteGrantBody) =>
			apiFetch<DeleteGrantContract['response']>('delete', `/v3/guilds/${guildId}/grants`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.grants.all(guildId) });
		},
	});
}
