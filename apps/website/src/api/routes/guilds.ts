import type {
	GuildChannelInfo,
	InferRouteContract,
	createGrantRoute,
	deleteGrantRoute,
	getGrantsRoute,
	getGuildRoute,
} from '@chatsift/api';
import type { BotId } from '@chatsift/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { useGrantAuth } from '../grant';
import { queryKeys } from '../queryClient';

export type { GuildChannelInfo } from '@chatsift/api';

type GetGuildContract = InferRouteContract<typeof getGuildRoute>;
export type GuildInfo = GetGuildContract['response'];

type GetGrantsContract = InferRouteContract<typeof getGrantsRoute>;
export type GetGrantsResult = GetGrantsContract['response'];
export type Grant = GetGrantsResult['grants'][number];

type CreateGrantContract = InferRouteContract<typeof createGrantRoute>;
export type CreateGrantBody = CreateGrantContract['body'];

type DeleteGrantContract = InferRouteContract<typeof deleteGrantRoute>;
export type DeleteGrantBody = DeleteGrantContract['body'];

/**
 * Transparently authed via the one-time grant-token flow when active (`useGrantAuth()`), same as `useMe()` --
 * callers don't need to know or care which auth path is in effect.
 */
export function useGuildInfo(guildId: string, forBot: BotId) {
	const grant = useGrantAuth();

	return useQuery({
		queryKey: queryKeys.guilds.info(guildId, forBot),
		queryFn: async () =>
			apiFetch<GuildInfo>('get', `/v3/guilds/${guildId}`, {
				query: { for_bot: forBot, force_fresh: false },
				authToken: grant?.token,
			}),
	});
}

/**
 * Force-revalidates a guild's channel list against Discord and writes the result into the shared
 * `useGuildInfo()` cache entry for the same `(guildId, forBot)` pair.
 */
export function useRefreshGuildInfo(guildId: string, forBot: BotId) {
	const grant = useGrantAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<GuildInfo>('get', `/v3/guilds/${guildId}`, {
				query: { for_bot: forBot, force_fresh: true },
				authToken: grant?.token,
			}),
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
