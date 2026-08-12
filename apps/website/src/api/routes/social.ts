import type {
	InferRouteContract,
	createSocialInteractionRoute,
	getSocialConfigRoute,
	listSocialChannelsRoute,
	listSocialInteractionsRoute,
	listSocialLeaderboardRoute,
	listSocialRewardsRoute,
	listSocialRolesRoute,
	publicSocialLeaderboardRoute,
	resyncSocialInteractionsRoute,
	updateSocialConfigRoute,
	updateSocialInteractionRoute,
	upsertSocialChannelRoute,
	upsertSocialRewardRoute,
	upsertSocialRoleRoute,
} from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type GetSocialConfigContract = InferRouteContract<typeof getSocialConfigRoute>;
export type SocialConfig = GetSocialConfigContract['response'];

type UpdateSocialConfigContract = InferRouteContract<typeof updateSocialConfigRoute>;
export type UpdateSocialConfigBody = UpdateSocialConfigContract['body'];

export function useSocialConfig(guildId: string) {
	return useQuery({
		queryKey: queryKeys.social.config(guildId),
		queryFn: async () => apiFetch<SocialConfig>('get', `/v3/guilds/${guildId}/social/config`),
	});
}

export function useUpdateSocialConfig(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateSocialConfigBody) =>
			apiFetch<SocialConfig>('patch', `/v3/guilds/${guildId}/social/config`, { body }),
		onSuccess(data) {
			queryClient.setQueryData(queryKeys.social.config(guildId), data);
		},
	});
}

type ListSocialChannelsContract = InferRouteContract<typeof listSocialChannelsRoute>;
export type SocialChannel = ListSocialChannelsContract['response'][number];

type UpsertSocialChannelContract = InferRouteContract<typeof upsertSocialChannelRoute>;
export type UpsertSocialChannelBody = UpsertSocialChannelContract['body'];

export function useSocialChannels(guildId: string) {
	return useQuery({
		queryKey: queryKeys.social.channels(guildId),
		queryFn: async () => apiFetch<SocialChannel[]>('get', `/v3/guilds/${guildId}/social/channels`),
	});
}

/**
 * A full-representation PUT keyed by the channel itself (see the API's `upsertSocialChannelBodySchema`), so the
 * create and edit forms post the exact same request -- there's no separate "create" hook for this table, or for
 * roles/rewards below.
 */
export function useUpsertSocialChannel(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ channelId, body }: { body: UpsertSocialChannelBody; channelId: string }) =>
			apiFetch<SocialChannel>('put', `/v3/guilds/${guildId}/social/channels/${channelId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.channels(guildId) });
		},
	});
}

export function useDeleteSocialChannel(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (channelId: string) => apiFetch('delete', `/v3/guilds/${guildId}/social/channels/${channelId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.channels(guildId) });
		},
	});
}

type ListSocialRolesContract = InferRouteContract<typeof listSocialRolesRoute>;
export type SocialRole = ListSocialRolesContract['response'][number];

type UpsertSocialRoleContract = InferRouteContract<typeof upsertSocialRoleRoute>;
export type UpsertSocialRoleBody = UpsertSocialRoleContract['body'];

export function useSocialRoles(guildId: string) {
	return useQuery({
		queryKey: queryKeys.social.roles(guildId),
		queryFn: async () => apiFetch<SocialRole[]>('get', `/v3/guilds/${guildId}/social/roles`),
	});
}

export function useUpsertSocialRole(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ roleId, body }: { body: UpsertSocialRoleBody; roleId: string }) =>
			apiFetch<SocialRole>('put', `/v3/guilds/${guildId}/social/roles/${roleId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.roles(guildId) });
		},
	});
}

export function useDeleteSocialRole(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (roleId: string) => apiFetch('delete', `/v3/guilds/${guildId}/social/roles/${roleId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.roles(guildId) });
		},
	});
}

type ListSocialRewardsContract = InferRouteContract<typeof listSocialRewardsRoute>;
export type SocialReward = ListSocialRewardsContract['response'][number];

type UpsertSocialRewardContract = InferRouteContract<typeof upsertSocialRewardRoute>;
export type UpsertSocialRewardBody = UpsertSocialRewardContract['body'];

export function useSocialRewards(guildId: string) {
	return useQuery({
		queryKey: queryKeys.social.rewards(guildId),
		queryFn: async () => apiFetch<SocialReward[]>('get', `/v3/guilds/${guildId}/social/rewards`),
	});
}

export function useUpsertSocialReward(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ roleId, body }: { body: UpsertSocialRewardBody; roleId: string }) =>
			apiFetch<SocialReward>('put', `/v3/guilds/${guildId}/social/rewards/${roleId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.rewards(guildId) });
		},
	});
}

export function useDeleteSocialReward(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (roleId: string) => apiFetch('delete', `/v3/guilds/${guildId}/social/rewards/${roleId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.rewards(guildId) });
		},
	});
}

type ListSocialInteractionsContract = InferRouteContract<typeof listSocialInteractionsRoute>;
export type SocialInteraction = ListSocialInteractionsContract['response'][number];

type CreateSocialInteractionContract = InferRouteContract<typeof createSocialInteractionRoute>;
export type CreateSocialInteractionBody = CreateSocialInteractionContract['body'];

type UpdateSocialInteractionContract = InferRouteContract<typeof updateSocialInteractionRoute>;
export type UpdateSocialInteractionBody = UpdateSocialInteractionContract['body'];

export function useSocialInteractions(guildId: string) {
	return useQuery({
		queryKey: queryKeys.social.interactions(guildId),
		queryFn: async () => apiFetch<SocialInteraction[]>('get', `/v3/guilds/${guildId}/social/interactions`),
	});
}

export function useCreateSocialInteraction(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateSocialInteractionBody) =>
			apiFetch<SocialInteraction>('post', `/v3/guilds/${guildId}/social/interactions`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.interactions(guildId) });
		},
	});
}

export function useUpdateSocialInteraction(guildId: string, interactionId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateSocialInteractionBody) =>
			apiFetch<SocialInteraction>('patch', `/v3/guilds/${guildId}/social/interactions/${interactionId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.interactions(guildId) });
		},
	});
}

export function useDeleteSocialInteraction(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (interactionId: number) =>
			apiFetch('delete', `/v3/guilds/${guildId}/social/interactions/${interactionId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.interactions(guildId) });
		},
	});
}

type ListSocialLeaderboardContract = InferRouteContract<typeof listSocialLeaderboardRoute>;
export type SocialLeaderboardPage = ListSocialLeaderboardContract['response'];
export type SocialLeaderboardEntry = SocialLeaderboardPage['entries'][number];

type PublicSocialLeaderboardContract = InferRouteContract<typeof publicSocialLeaderboardRoute>;
export type PublicSocialLeaderboardResult = PublicSocialLeaderboardContract['response'];

/**
 * Rows per leaderboard page, and the value every offset here is a multiple of. Kept below the API's own
 * `MAX_PAGE_SIZE` (50) for the reason that cap exists: a page costs one `GET /users/{id}` per row on a cold
 * user cache, so a smaller page is a page that renders promptly the first time anyone opens it.
 */
export const SOCIAL_LEADERBOARD_PAGE_SIZE = 25;

export function useSocialLeaderboard(guildId: string, page: number) {
	const offset = (page - 1) * SOCIAL_LEADERBOARD_PAGE_SIZE;

	return useQuery({
		queryKey: queryKeys.social.leaderboardPage(guildId, offset),
		queryFn: async () =>
			apiFetch<SocialLeaderboardPage>('get', `/v3/guilds/${guildId}/social/leaderboard`, {
				query: { limit: SOCIAL_LEADERBOARD_PAGE_SIZE, offset },
			}),
		// Keeps the previous page on screen while the next one loads, rather than collapsing the table to a
		// skeleton on every click -- and, more to the point here, while a realtime signal refetches.
		placeholderData: (previous) => previous,
	});
}

/**
 * Shared by the public page's hook and its server-side prefetch/metadata read
 * (`app/leaderboard/[guildId]/_lib/publicLeaderboard.ts`), same arrangement as `publicAMAAnswersPath`.
 */
export function publicSocialLeaderboardPath(guildId: string): string {
	return `/v3/social/public/${guildId}`;
}

/**
 * The matching ticket endpoint, handed to `usePublicRealtimeClient`. See `publicAMAWsTicketPath`.
 */
export function publicSocialLeaderboardWsTicketPath(guildId: string): string {
	return `/v3/social/public/${encodeURIComponent(guildId)}/ws-ticket`;
}

export function usePublicSocialLeaderboard(guildId: string, page: number) {
	const offset = (page - 1) * SOCIAL_LEADERBOARD_PAGE_SIZE;

	return useQuery({
		queryKey: queryKeys.social.publicLeaderboardPage(guildId, offset),
		queryFn: async () =>
			apiFetch<PublicSocialLeaderboardResult>('get', publicSocialLeaderboardPath(guildId), {
				query: { limit: SOCIAL_LEADERBOARD_PAGE_SIZE, offset },
			}),
		placeholderData: (previous) => previous,
	});
}

type ResyncSocialInteractionsContract = InferRouteContract<typeof resyncSocialInteractionsRoute>;
export type ResyncSocialInteractionsResult = ResyncSocialInteractionsContract['response'];

/**
 * Reissues every interaction's guild command under whichever application currently owns this guild (#343 ledger
 * item 3). Unlike ModMail's resyncs this isn't a custom-instance-only affordance: every row migrated out of
 * legacy Social arrives with a null `commandId` and needs exactly this run once, which is why the card that
 * calls it stays visible for every guild.
 */
export function useResyncSocialInteractions(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<ResyncSocialInteractionsResult>('post', `/v3/guilds/${guildId}/social/interactions/resync`, {
				body: {},
			}),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.social.interactions(guildId) });
		},
	});
}
