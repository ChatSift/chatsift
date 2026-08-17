import type {
	InferRouteContract,
	createAutomoderatorReportPresetRoute,
	deleteAutomoderatorReportPresetRoute,
	getAutomoderatorReportRoute,
	listAutomoderatorReportPresetsRoute,
	listAutomoderatorReportsRoute,
	updateAutomoderatorReportPresetRoute,
} from '@chatsift/api';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type ListReportsContract = InferRouteContract<typeof listAutomoderatorReportsRoute>;
export type ListAutomoderatorReportsResult = ListReportsContract['response'];
export type AutomoderatorReportListItem = ListAutomoderatorReportsResult['reports'][number];

type GetReportContract = InferRouteContract<typeof getAutomoderatorReportRoute>;
export type GetAutomoderatorReportResult = GetReportContract['response'];

type ListPresetsContract = InferRouteContract<typeof listAutomoderatorReportPresetsRoute>;
export type AutomoderatorReportPresets = ListPresetsContract['response'];

type CreatePresetContract = InferRouteContract<typeof createAutomoderatorReportPresetRoute>;
export type CreateAutomoderatorReportPresetBody = CreatePresetContract['body'];

type UpdatePresetContract = InferRouteContract<typeof updateAutomoderatorReportPresetRoute>;
export type UpdateAutomoderatorReportPresetBody = UpdatePresetContract['body'];

type DeletePresetContract = InferRouteContract<typeof deleteAutomoderatorReportPresetRoute>;
export type DeleteAutomoderatorReportPresetParams = DeletePresetContract['params'];

export interface ReportFilters {
	state?: string | undefined;
	targetId?: string | undefined;
}

export function useAutomoderatorReports(guildId: string, filters: ReportFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.automoderator.reports.list(guildId, filters),
		queryFn: async ({ pageParam }) =>
			apiFetch<ListAutomoderatorReportsResult>('get', `/v3/guilds/${guildId}/automoderator/reports`, {
				query: { cursor: pageParam, state: filters.state, target_id: filters.targetId },
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}

export function useAutomoderatorReport(guildId: string, reportId: number) {
	return useQuery({
		queryKey: queryKeys.automoderator.reports.byId(guildId, reportId),
		queryFn: async () =>
			apiFetch<GetAutomoderatorReportResult>('get', `/v3/guilds/${guildId}/automoderator/reports/${reportId}`),
	});
}

export function useAutomoderatorReportPresets(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.reportPresets(guildId),
		queryFn: async () =>
			apiFetch<AutomoderatorReportPresets>('get', `/v3/guilds/${guildId}/automoderator/report-presets`),
	});
}

export function useCreateAutomoderatorReportPreset(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateAutomoderatorReportPresetBody) =>
			apiFetch<AutomoderatorReportPresets[number]>('post', `/v3/guilds/${guildId}/automoderator/report-presets`, {
				body,
			}),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPresets(guildId) });
		},
	});
}

export function useUpdateAutomoderatorReportPreset(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ presetId, ...body }: UpdateAutomoderatorReportPresetBody & { presetId: number }) =>
			apiFetch<AutomoderatorReportPresets[number]>(
				'patch',
				`/v3/guilds/${guildId}/automoderator/report-presets/${presetId}`,
				{ body },
			),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPresets(guildId) });
		},
	});
}

export function useDeleteAutomoderatorReportPreset(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (presetId: number) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/report-presets/${presetId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPresets(guildId) });
		},
	});
}
