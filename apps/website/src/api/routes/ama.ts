import type {
	InferRouteContract,
	createAMARoute,
	getAMARoute,
	getAMAStatsRoute,
	getAMAsRoute,
	repostPromptRoute,
	updateAMARoute,
} from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiFetchBlob } from '../fetch';
import { useGrantAuth } from '../grant';
import { queryKeys } from '../queryClient';

export type { PossiblyMissingChannelInfo } from '@chatsift/api';

type GetAMAsContract = InferRouteContract<typeof getAMAsRoute>;
export type AMASessionWithCount = GetAMAsContract['response'][number];

type GetAMAContract = InferRouteContract<typeof getAMARoute>;
export type AMASessionDetailed = GetAMAContract['response'];

type GetAMAStatsContract = InferRouteContract<typeof getAMAStatsRoute>;
export type AMAStats = GetAMAStatsContract['response'];

type CreateAMAContract = InferRouteContract<typeof createAMARoute>;
export type CreateAMABody = CreateAMAContract['body'];
export type CreateAMAResult = CreateAMAContract['response'];

type UpdateAMAContract = InferRouteContract<typeof updateAMARoute>;
export type UpdateAMABody = UpdateAMAContract['body'];

type RepostPromptContract = InferRouteContract<typeof repostPromptRoute>;

/**
 * Transparently authed via the one-time grant-token flow when active (`useGrantAuth()`), same as `useMe()` --
 * lets `AMADashboardCrumbs`' "switch AMA" dropdown work on the grant-created page without it needing to know
 * grant auth exists.
 */
export function useAMAs(guildId: string, includeEnded: boolean) {
	const grant = useGrantAuth();

	return useQuery({
		queryKey: queryKeys.ama.list(guildId, includeEnded),
		queryFn: async () =>
			apiFetch<AMASessionWithCount[]>('get', `/v3/guilds/${guildId}/ama/amas`, {
				query: { include_ended: includeEnded },
				authToken: grant?.token,
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

export function useAMAStats(guildId: string, amaId: string | undefined) {
	return useQuery({
		queryKey: queryKeys.ama.stats(guildId, amaId ?? ''),
		queryFn: async () => apiFetch<AMAStats>('get', `/v3/guilds/${guildId}/ama/amas/${amaId}/stats`),
		enabled: amaId !== undefined,
	});
}

export function useExportAMAQuestions(guildId: string, amaId: string) {
	return useMutation({
		mutationFn: async () => {
			const blob = await apiFetchBlob(`/v3/guilds/${guildId}/ama/amas/${amaId}/export`);
			const url = URL.createObjectURL(blob);
			try {
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = `ama-${amaId}-questions.csv`;
				anchor.click();
			} finally {
				URL.revokeObjectURL(url);
			}
		},
	});
}

export function useCreateAMA(guildId: string) {
	const grant = useGrantAuth();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateAMABody) =>
			apiFetch<CreateAMAResult>('post', `/v3/guilds/${guildId}/ama/amas`, { body, authToken: grant?.token }),
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
