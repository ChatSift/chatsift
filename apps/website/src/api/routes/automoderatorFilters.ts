import type {
	createAllowedInviteRoute,
	createAllowedUrlRoute,
	InferRouteContract,
	listAllowedInvitesRoute,
	listAllowedUrlsRoute,
	listFilterExemptionsRoute,
	setFilterExemptionRoute,
} from '@chatsift/api';
import type { writableFilterKindSchema } from '@chatsift/api/automoderator-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListUrlsContract = InferRouteContract<typeof listAllowedUrlsRoute>;
export type AllowedUrls = ListUrlsContract['response'];
export type AllowedUrl = AllowedUrls[number];

type CreateUrlContract = InferRouteContract<typeof createAllowedUrlRoute>;
export type CreateAllowedUrlBody = CreateUrlContract['body'];

type ListInvitesContract = InferRouteContract<typeof listAllowedInvitesRoute>;
export type AllowedInvites = ListInvitesContract['response'];
export type AllowedInvite = AllowedInvites[number];

type CreateInviteContract = InferRouteContract<typeof createAllowedInviteRoute>;
export type CreateAllowedInviteBody = CreateInviteContract['body'];

type ListExemptionsContract = InferRouteContract<typeof listFilterExemptionsRoute>;
export type FilterExemptions = ListExemptionsContract['response'];
export type FilterExemption = FilterExemptions[number];

type SetExemptionContract = InferRouteContract<typeof setFilterExemptionRoute>;
export type SetFilterExemptionBody = SetExemptionContract['body'];

export type FilterKind = (typeof writableFilterKindSchema.options)[number];

export function useAutomoderatorAllowedUrls(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.allowedUrls(guildId),
		queryFn: async () => apiFetch<AllowedUrls>('get', `/v3/guilds/${guildId}/automoderator/allowed-urls`),
	});
}

export function useCreateAutomoderatorAllowedUrl(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// POST rather than a PUT keyed on the domain: the API normalises whatever was pasted down to a bare
		// host, so the row's identity is not what the client sent and the response is what actually got stored.
		mutationFn: async (body: CreateAllowedUrlBody) =>
			apiFetch<AllowedUrl>('post', `/v3/guilds/${guildId}/automoderator/allowed-urls`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.allowedUrls(guildId) });
		},
	});
}

export function useDeleteAutomoderatorAllowedUrl(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// Encoded because a domain is a path segment here and nothing stops one containing a character that
		// would otherwise re-parse the URL.
		mutationFn: async (domain: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/allowed-urls/${encodeURIComponent(domain)}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.allowedUrls(guildId) });
		},
	});
}

export function useAutomoderatorAllowedInvites(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.allowedInvites(guildId),
		queryFn: async () => apiFetch<AllowedInvites>('get', `/v3/guilds/${guildId}/automoderator/allowed-invites`),
	});
}

export function useCreateAutomoderatorAllowedInvite(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateAllowedInviteBody) =>
			apiFetch<AllowedInvite>('post', `/v3/guilds/${guildId}/automoderator/allowed-invites`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.allowedInvites(guildId) });
		},
	});
}

export function useDeleteAutomoderatorAllowedInvite(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (allowedGuildId: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/allowed-invites/${allowedGuildId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.allowedInvites(guildId) });
		},
	});
}

export function useAutomoderatorFilterExemptions(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.filterExemptions(guildId),
		queryFn: async () => apiFetch<FilterExemptions>('get', `/v3/guilds/${guildId}/automoderator/filter-exemptions`),
	});
}

export function useSetAutomoderatorFilterExemption(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// The full set for that channel, not a delta -- see `setFilterExemptionBodySchema`. Toggling one filter
		// therefore sends both, which is what keeps the client from having to diff two states it only has one of.
		mutationFn: async ({ channelId, ...body }: SetFilterExemptionBody & { channelId: string }) =>
			apiFetch<FilterExemption>('put', `/v3/guilds/${guildId}/automoderator/filter-exemptions/${channelId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.filterExemptions(guildId) });
		},
	});
}

export function useDeleteAutomoderatorFilterExemption(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (channelId: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/filter-exemptions/${channelId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.filterExemptions(guildId) });
		},
	});
}
