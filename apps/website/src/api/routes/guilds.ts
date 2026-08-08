import type {
	GuildChannelInfo,
	GuildEmojiInfo,
	GuildRoleInfo,
	InferRouteContract,
	createGrantRoute,
	deleteGrantRoute,
	getGrantsRoute,
	getGuildRoute,
} from '@chatsift/api';
import type { BotId } from '@chatsift/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';
import { useGuildAccess } from '@/hooks/useGuildAccess';

export type { GuildChannelInfo, GuildEmojiInfo, GuildRoleInfo } from '@chatsift/api';

type GetGuildContract = InferRouteContract<typeof getGuildRoute>;
export type GuildInfo = GetGuildContract['response'];

type GetGrantsContract = InferRouteContract<typeof getGrantsRoute>;
export type GetGrantsResult = GetGrantsContract['response'];
export type Grant = GetGrantsResult['grants'][number];

type CreateGrantContract = InferRouteContract<typeof createGrantRoute>;
export type CreateGrantBody = CreateGrantContract['body'];

type DeleteGrantContract = InferRouteContract<typeof deleteGrantRoute>;
export type DeleteGrantBody = DeleteGrantContract['body'];

export function useGuildInfo(guildId: string, forBot: BotId) {
	// `GET /v3/guilds/:guildId` is hard manager-only (`isGuildManager: true` in the API's `isAuthed`) with no
	// AMA-guest carve-out, and shouldn't have one -- it returns the guild's entire channel/role/emoji list,
	// well beyond what being a guest on a single session is meant to expose (and the route takes no `amaId` to
	// scope such a check against anyway). So skip the request outright for a non-manager rather than having
	// every page that mounts this fire a guaranteed 403: an AMA guest viewing a session detail page hit exactly
	// that. Gated here rather than at each call site so no future consumer has to remember. Consumers already
	// cope with a missing result -- they read through `guildInfo?.x ?? []`, and the forms that genuinely need
	// channels/roles (config editors, create flows) are `canManage`-gated or on manager-only pages regardless.
	const { canManage } = useGuildAccess(guildId);

	return useQuery({
		queryKey: queryKeys.guilds.info(guildId, forBot),
		// A disabled query stays `isPending` but never `isFetching`, so `isLoading` is `false` for a guest --
		// call sites that disable controls on `isLoading` don't get stuck in a permanent loading state.
		enabled: canManage,
		queryFn: async () =>
			apiFetch<GuildInfo>('get', `/v3/guilds/${guildId}`, {
				query: { for_bot: forBot, force_fresh: false },
			}),
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
			apiFetch<GuildInfo>('get', `/v3/guilds/${guildId}`, {
				query: { for_bot: forBot, force_fresh: true },
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
