import type {
	InferRouteContract,
	createAMARoute,
	getAMARoute,
	getAMAsRoute,
	repostPromptRoute,
	updateAMARoute,
} from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type GetAMAsContract = InferRouteContract<typeof getAMAsRoute>;
export type AMASessionWithCount = GetAMAsContract['response'][number];

type GetAMAContract = InferRouteContract<typeof getAMARoute>;
export type AMASessionDetailed = GetAMAContract['response'];

/**
 * Structurally identical to the server's `util/channels.ts#PossiblyMissingChannelInfo` — a channel that used to
 * be configured for an AMA but could no longer be resolved via the Discord API (deleted, bot kicked, etc).
 */
export interface PossiblyMissingChannelInfo {
	id: string;
}

type CreateAMAContract = InferRouteContract<typeof createAMARoute>;
export type CreateAMABody = CreateAMAContract['body'];
export type CreateAMAResult = CreateAMAContract['response'];

type UpdateAMAContract = InferRouteContract<typeof updateAMARoute>;
export type UpdateAMABody = UpdateAMAContract['body'];

type RepostPromptContract = InferRouteContract<typeof repostPromptRoute>;

export function useAMAs(guildId: string, includeEnded: boolean) {
	return useQuery({
		queryKey: queryKeys.ama.list(guildId, includeEnded),
		queryFn: async () =>
			apiFetch<AMASessionWithCount[]>('get', `/v3/guilds/${guildId}/ama/amas`, {
				query: { include_ended: includeEnded },
			}),
	});
}

export function useAMA(guildId: string, amaId: string | undefined) {
	return useQuery({
		queryKey: queryKeys.ama.byId(guildId, amaId ?? ''),
		queryFn: async () => apiFetch<AMASessionDetailed>('get', `/v3/guilds/${guildId}/ama/amas/${amaId}`),
		enabled: amaId !== undefined,
	});
}

export function useCreateAMA(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateAMABody) =>
			apiFetch<CreateAMAResult>('post', `/v3/guilds/${guildId}/ama/amas`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.ama.all(guildId) });
		},
	});
}

export function useUpdateAMA(guildId: string, amaId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateAMABody) =>
			apiFetch<UpdateAMAContract['response']>('patch', `/v3/guilds/${guildId}/ama/amas/${amaId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.ama.all(guildId) });
		},
	});
}

export function useRepostPrompt(guildId: string, amaId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<RepostPromptContract['response']>('post', `/v3/guilds/${guildId}/ama/amas/${amaId}/prompt`, {
				body: {},
			}),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.ama.byId(guildId, amaId) });
		},
	});
}
