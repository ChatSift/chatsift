import type {
	InferRouteContract,
	automoderatorPublicHistoryRoute,
	deleteAutomoderatorCaseRoute,
	deleteAutomoderatorLogChannelRoute,
	getAutomoderatorCaseRoute,
	listAutomoderatorCasesRoute,
	listAutomoderatorLogChannelsRoute,
	listAutomoderatorLogExemptionsRoute,
	setAutomoderatorLogChannelRoute,
	updateAutomoderatorCaseRoute,
} from '@chatsift/api';
import type { WritableLogType } from '@chatsift/api/automoderator-schemas';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListCasesContract = InferRouteContract<typeof listAutomoderatorCasesRoute>;
export type ListAutomoderatorCasesResult = ListCasesContract['response'];
export type AutomoderatorCaseListItem = ListAutomoderatorCasesResult['cases'][number];

type GetCaseContract = InferRouteContract<typeof getAutomoderatorCaseRoute>;
export type GetAutomoderatorCaseResult = GetCaseContract['response'];

type UpdateCaseContract = InferRouteContract<typeof updateAutomoderatorCaseRoute>;
export type UpdateAutomoderatorCaseBody = UpdateCaseContract['body'];

type ListLogChannelsContract = InferRouteContract<typeof listAutomoderatorLogChannelsRoute>;
export type AutomoderatorLogChannels = ListLogChannelsContract['response'];

type SetLogChannelContract = InferRouteContract<typeof setAutomoderatorLogChannelRoute>;
export type SetAutomoderatorLogChannelBody = SetLogChannelContract['body'];

type ListLogExemptionsContract = InferRouteContract<typeof listAutomoderatorLogExemptionsRoute>;
export type AutomoderatorLogExemptions = ListLogExemptionsContract['response'];

type PublicHistoryContract = InferRouteContract<typeof automoderatorPublicHistoryRoute>;
export type PublicHistoryResult = PublicHistoryContract['response'];

/**
 * The unauthenticated `/myhistory` page
 */
export function useAutomoderatorPublicHistory(token: string) {
	return useQuery({
		queryKey: ['api', 'automoderator', 'public-history', token] as const,
		queryFn: async () => apiFetch<PublicHistoryResult>('get', `/v3/automoderator/history/${token}`),
		retry: false,
	});
}

export interface CaseFilters {
	action?: string | undefined;
	includePardoned: boolean;
	targetId?: string | undefined;
}

export function useAutomoderatorCases(guildId: string, filters: CaseFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.automoderator.cases.list(guildId, filters),
		queryFn: async ({ pageParam }) =>
			apiFetch<ListAutomoderatorCasesResult>('get', `/v3/guilds/${guildId}/automoderator/cases`, {
				query: {
					cursor: pageParam,
					action: filters.action,
					target_id: filters.targetId,
					include_pardoned: filters.includePardoned,
				},
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}

export function useAutomoderatorCase(guildId: string, caseId: number) {
	return useQuery({
		queryKey: queryKeys.automoderator.cases.byId(guildId, caseId),
		queryFn: async () =>
			apiFetch<GetAutomoderatorCaseResult>('get', `/v3/guilds/${guildId}/automoderator/cases/${caseId}`),
	});
}

export function useUpdateAutomoderatorCase(guildId: string, caseId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateAutomoderatorCaseBody) =>
			apiFetch<AutomoderatorCaseListItem>('patch', `/v3/guilds/${guildId}/automoderator/cases/${caseId}`, { body }),
		async onSuccess() {
			// Invalidates the whole case subtree rather than patching the detail entry: an amendment can move a
			// case out of the list currently on screen (pardoning one, with pardoned hidden), so the list has to
			// re-ask rather than be told.
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.cases.all(guildId) });
		},
	});
}

export function useDeleteAutomoderatorCase(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (caseId: number) => apiFetch('delete', `/v3/guilds/${guildId}/automoderator/cases/${caseId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.cases.all(guildId) });
		},
	});
}

export function useAutomoderatorLogChannels(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.logChannels(guildId),
		queryFn: async () => apiFetch<AutomoderatorLogChannels>('get', `/v3/guilds/${guildId}/automoderator/log-channels`),
	});
}

export function useSetAutomoderatorLogChannel(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ logType, ...body }: SetAutomoderatorLogChannelBody & { logType: WritableLogType }) =>
			apiFetch<AutomoderatorLogChannels[number]>('put', `/v3/guilds/${guildId}/automoderator/log-channels/${logType}`, {
				body,
			}),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.logChannels(guildId) });
		},
	});
}

export function useDeleteAutomoderatorLogChannel(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (logType: WritableLogType) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/log-channels/${logType}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.logChannels(guildId) });
		},
	});
}

export function useAutomoderatorLogExemptions(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.logExemptions(guildId),
		queryFn: async () =>
			apiFetch<AutomoderatorLogExemptions>('get', `/v3/guilds/${guildId}/automoderator/log-exemptions`),
	});
}

export function useSetAutomoderatorLogExemption(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		// Body-less: the channel *is* the row, so the id in the path is the whole request. `PUT` rather than
		// `POST` for the same reason -- re-adding one already exempt is a no-op, not a conflict.
		mutationFn: async (channelId: string) =>
			apiFetch<AutomoderatorLogExemptions[number]>(
				'put',
				`/v3/guilds/${guildId}/automoderator/log-exemptions/${channelId}`,
			),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.logExemptions(guildId) });
		},
	});
}

export function useDeleteAutomoderatorLogExemption(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (channelId: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/log-exemptions/${channelId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.logExemptions(guildId) });
		},
	});
}
