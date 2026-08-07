import type {
	InferRouteContract,
	createAMARoute,
	createAMATagRoute,
	getAMAQuestionRoute,
	getAMARoute,
	getAMAStatsRoute,
	getAMAsRoute,
	listAMAQuestionsRoute,
	listAMATagsRoute,
	mergeAMAQuestionRoute,
	mergeAMAQuestionsBulkRoute,
	publicAMAAnswersRoute,
	repostPromptRoute,
	sendAMAQuestionRoute,
	updateAMAQuestionRoute,
	updateAMARoute,
} from '@chatsift/api';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

type ListAMAQuestionsContract = InferRouteContract<typeof listAMAQuestionsRoute>;
export type ListAMAQuestionsResult = ListAMAQuestionsContract['response'];
export type AMAQuestionListItem = ListAMAQuestionsResult['questions'][number];

type GetAMAQuestionContract = InferRouteContract<typeof getAMAQuestionRoute>;
export type AMAQuestionDetail = GetAMAQuestionContract['response'];

type UpdateAMAQuestionContract = InferRouteContract<typeof updateAMAQuestionRoute>;
export type UpdateAMAQuestionBody = UpdateAMAQuestionContract['body'];

type MergeAMAQuestionContract = InferRouteContract<typeof mergeAMAQuestionRoute>;
export type MergeAMAQuestionBody = MergeAMAQuestionContract['body'];

type MergeAMAQuestionsBulkContract = InferRouteContract<typeof mergeAMAQuestionsBulkRoute>;
export type MergeAMAQuestionsBulkBody = MergeAMAQuestionsBulkContract['body'];

type ListAMATagsContract = InferRouteContract<typeof listAMATagsRoute>;
export type AMATag = ListAMATagsContract['response'][number];

type CreateAMATagContract = InferRouteContract<typeof createAMATagRoute>;
export type CreateAMATagBody = CreateAMATagContract['body'];

type PublicAMAAnswersContract = InferRouteContract<typeof publicAMAAnswersRoute>;
export type PublicAMAAnswersResult = PublicAMAAnswersContract['response'];
export type PublicUserInfo = PublicAMAAnswersResult['questions'][number]['author'];

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
			// A successful grant-authed create burns the grant token server-side (single use) -- invalidating here
			// would trigger `useAMAs`' currently-mounted refetch (e.g. via `AMADashboardCrumbs` on this same page)
			// to replay that now-consumed token and 401. Session-based creates don't have this problem.
			if (grant) {
				return;
			}

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

export interface AMAQuestionFilters {
	authorId?: string | undefined;
	q?: string | undefined;
	states?: string | undefined;
	tagId?: number | undefined;
}

/**
 * Backs the question list view's three first-class entry points (by state / by tag / by author) --
 * they're just different pre-set `filters` combinations of the same paginated route (#293 follow-up),
 * not separate hooks. `useInfiniteQuery` mirrors `useModmailThreads`, the first paginated list in the
 * dashboard.
 */
export function useAMAQuestions(guildId: string, amaId: string, filters: AMAQuestionFilters = {}) {
	const { authorId, q = '', states, tagId } = filters;

	return useInfiniteQuery({
		queryKey: queryKeys.ama.questions.list(guildId, amaId, states, tagId, authorId, q),
		queryFn: async ({ pageParam }) =>
			apiFetch<ListAMAQuestionsResult>('get', `/v3/guilds/${guildId}/ama/amas/${amaId}/questions`, {
				query: { cursor: pageParam, states, tag_id: tagId, author_id: authorId, q: q || undefined },
			}),
		initialPageParam: undefined as number | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
	});
}

export function useAMAQuestion(guildId: string, amaId: string, questionId: number | undefined, enabled = true) {
	return useQuery({
		queryKey: queryKeys.ama.questions.byId(guildId, amaId, questionId ?? -1),
		queryFn: async () =>
			apiFetch<AMAQuestionDetail>('get', `/v3/guilds/${guildId}/ama/amas/${amaId}/questions/${questionId}`),
		enabled: questionId !== undefined && enabled,
	});
}

/**
 * Also called directly by `useRealtimeInvalidate` (`hooks/useRealtimeInvalidate.ts`) as the reaction to a
 * `ws.ts` invalidate signal on the `amaQuestionsChannel` -- the gateway only ever says "something on this
 * channel changed", so the reaction is exactly the same cache invalidation a local mutation's own
 * `onSuccess` already does below.
 */
export async function invalidateAMAQuestions(
	queryClient: ReturnType<typeof useQueryClient>,
	guildId: string,
	amaId: string,
) {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: queryKeys.ama.questions.all(guildId, amaId) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.ama.stats(guildId, amaId) }),
	]);
}

export function useUpdateAMAQuestion(guildId: string, amaId: string, questionId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateAMAQuestionBody) =>
			apiFetch<AMAQuestionDetail>('patch', `/v3/guilds/${guildId}/ama/amas/${amaId}/questions/${questionId}`, { body }),
		async onSuccess() {
			await invalidateAMAQuestions(queryClient, guildId, amaId);
		},
	});
}

export function useSendAMAQuestion(guildId: string, amaId: string, questionId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<AMAQuestionDetail>('post', `/v3/guilds/${guildId}/ama/amas/${amaId}/questions/${questionId}/send`, {
				body: {},
			}),
		async onSuccess() {
			await invalidateAMAQuestions(queryClient, guildId, amaId);
		},
	});
}

export function useMergeAMAQuestion(guildId: string, amaId: string, questionId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: MergeAMAQuestionBody) =>
			apiFetch<AMAQuestionDetail>('post', `/v3/guilds/${guildId}/ama/amas/${amaId}/questions/${questionId}/merge`, {
				body,
			}),
		async onSuccess() {
			await invalidateAMAQuestions(queryClient, guildId, amaId);
		},
	});
}

export function useMergeAMAQuestionsBulk(guildId: string, amaId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: MergeAMAQuestionsBulkBody) =>
			apiFetch<AMAQuestionDetail>('post', `/v3/guilds/${guildId}/ama/amas/${amaId}/questions/merge-bulk`, {
				body,
			}),
		async onSuccess() {
			await invalidateAMAQuestions(queryClient, guildId, amaId);
		},
	});
}

export function useAMATags(guildId: string, amaId: string) {
	return useQuery({
		queryKey: queryKeys.ama.tags(guildId, amaId),
		queryFn: async () => apiFetch<AMATag[]>('get', `/v3/guilds/${guildId}/ama/amas/${amaId}/tags`),
	});
}

export function useCreateAMATag(guildId: string, amaId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateAMATagBody) =>
			apiFetch<AMATag>('post', `/v3/guilds/${guildId}/ama/amas/${amaId}/tags`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.ama.tags(guildId, amaId) });
		},
	});
}

export function usePublicAMAAnswers(shareToken: string) {
	return useQuery({
		queryKey: queryKeys.ama.publicAnswers(shareToken),
		queryFn: async () => apiFetch<PublicAMAAnswersResult>('get', `/v3/ama/public/${shareToken}`),
	});
}
