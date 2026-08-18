import type {
	InferRouteContract,
	createAutomoderatorReportPresetRoute,
	createAutomoderatorReportPromptRoute,
	deleteAutomoderatorReportPresetRoute,
	deleteAutomoderatorReportPromptRoute,
	getAutomoderatorReportDraftRoute,
	getAutomoderatorReportRoute,
	listAutomoderatorReportPresetsRoute,
	listAutomoderatorReportPromptsRoute,
	listAutomoderatorReportsRoute,
	submitAutomoderatorReportDraftRoute,
	updateAutomoderatorReportPresetRoute,
	updateAutomoderatorReportPromptRoute,
} from '@chatsift/api';
import type { reportStateSchema } from '@chatsift/api/automoderator-schemas';
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

type GetReportDraftContract = InferRouteContract<typeof getAutomoderatorReportDraftRoute>;
export type GetAutomoderatorReportDraftResult = GetReportDraftContract['response'];
export type AutomoderatorReportDraftMessage = GetAutomoderatorReportDraftResult['messages'][number];
export type AutomoderatorReportCandidateGuild = GetAutomoderatorReportDraftResult['guilds'][number];

type SubmitReportDraftContract = InferRouteContract<typeof submitAutomoderatorReportDraftRoute>;
export type SubmitAutomoderatorReportDraftBody = SubmitReportDraftContract['body'];
export type SubmitAutomoderatorReportDraftResult = SubmitReportDraftContract['response'];

/**
 * The DM report a member is about to confirm (P3b).
 *
 * `retry: false` because every failure here is terminal and self-explanatory -- an expired link, a draft that
 * timed out, or a session belonging to somebody else. Retrying would only delay the message that says so.
 */
export function useAutomoderatorReportDraft(token: string, enabled: boolean) {
	return useQuery({
		queryKey: ['api', 'automoderator', 'report-draft', token] as const,
		queryFn: async () => apiFetch<GetAutomoderatorReportDraftResult>('get', `/v3/automoderator/report-drafts/${token}`),
		retry: false,
		enabled,
	});
}

export function useSubmitAutomoderatorReportDraft(token: string) {
	return useMutation({
		mutationFn: async (body: SubmitAutomoderatorReportDraftBody) =>
			apiFetch<SubmitAutomoderatorReportDraftResult>('post', `/v3/automoderator/report-drafts/${token}`, { body }),
	});
}

/**
 * The report states, straight off the API's own zod enum -- so a filter value the route would reject can't be
 * constructed here in the first place. Defined in this layer because it is part of the contract surface, like
 * the `Infer*` types above.
 */
export type ReportStateName = (typeof reportStateSchema.options)[number];

export interface ReportFilters {
	state?: ReportStateName | undefined;
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

type ListReportPromptsContract = InferRouteContract<typeof listAutomoderatorReportPromptsRoute>;
export type AutomoderatorReportPrompts = ListReportPromptsContract['response'];
export type AutomoderatorReportPrompt = AutomoderatorReportPrompts[number];

type CreateReportPromptContract = InferRouteContract<typeof createAutomoderatorReportPromptRoute>;
export type CreateAutomoderatorReportPromptBody = CreateReportPromptContract['body'];

type UpdateReportPromptContract = InferRouteContract<typeof updateAutomoderatorReportPromptRoute>;
export type UpdateAutomoderatorReportPromptBody = UpdateReportPromptContract['body'];

type DeleteReportPromptContract = InferRouteContract<typeof deleteAutomoderatorReportPromptRoute>;
export type DeleteAutomoderatorReportPromptParams = DeleteReportPromptContract['params'];
export type DeleteAutomoderatorReportPromptResult = DeleteReportPromptContract['response'];

/**
 * The DM-reporting install prompts a guild has posted (P3b).
 */
export function useAutomoderatorReportPrompts(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.reportPrompts(guildId),
		queryFn: async () =>
			apiFetch<AutomoderatorReportPrompts>('get', `/v3/guilds/${guildId}/automoderator/report-prompts`),
	});
}

export function useCreateAutomoderatorReportPrompt(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateAutomoderatorReportPromptBody) =>
			apiFetch<AutomoderatorReportPrompt>('post', `/v3/guilds/${guildId}/automoderator/report-prompts`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPrompts(guildId) });
		},
	});
}

export function useUpdateAutomoderatorReportPrompt(guildId: string, promptId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateAutomoderatorReportPromptBody) =>
			apiFetch<AutomoderatorReportPrompt>('patch', `/v3/guilds/${guildId}/automoderator/report-prompts/${promptId}`, {
				body,
			}),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPrompts(guildId) });
		},
	});
}

export function useDeleteAutomoderatorReportPrompt(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (promptId: number) =>
			apiFetch<DeleteAutomoderatorReportPromptResult>(
				'delete',
				`/v3/guilds/${guildId}/automoderator/report-prompts/${promptId}`,
			),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPrompts(guildId) });
		},
	});
}
