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
// Deliberately not `AMATag`: a freshly created tag has no `count` on it (nothing's assigned to it yet, and
// `createTag.ts` doesn't compute one) -- only `listTags.ts` carries that.
export type CreateAMATagResult = CreateAMATagContract['response'];

type PublicAMAAnswersContract = InferRouteContract<typeof publicAMAAnswersRoute>;
export type PublicAMAAnswersResult = PublicAMAAnswersContract['response'];
export type PublicUserInfo = PublicAMAAnswersResult['questions'][number]['author'];

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
 *
 * Also invalidates `useAMA`'s own query (`ama.byId`), not just the question list/stats -- `getAMA.ts` computes
 * `questionCount` live off the same `ama_questions` table, and `AMADetails.tsx` renders it, so a question
 * being added/merged/removed has to refresh that cached session object too or it silently goes stale.
 *
 * `ama.tags` is in here for the same reason: tag create/delete publish on `amaQuestionsChannel` (there's
 * no separate tag channel), so without it a tag someone else just deleted would linger in this viewer's
 * picker and filter until a reload. It also keeps each tag's `count` honest -- `listTags.ts` returns one
 * per tag, and every assignment change moves it.
 */
export async function invalidateAMAQuestions(
	queryClient: ReturnType<typeof useQueryClient>,
	guildId: string,
	amaId: string,
) {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: queryKeys.ama.questions.all(guildId, amaId) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.ama.stats(guildId, amaId) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.ama.byId(guildId, amaId) }),
		queryClient.invalidateQueries({ queryKey: queryKeys.ama.tags(guildId, amaId) }),
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
			apiFetch<CreateAMATagResult>('post', `/v3/guilds/${guildId}/ama/amas/${amaId}/tags`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.ama.tags(guildId, amaId) });
		},
	});
}

/**
 * Deleting a tag cascades its assignments off every question that carried it, so this has to refresh the
 * question/stats caches too, not just the tag list -- hence `invalidateAMAQuestions` on top of the tag
 * key (which that helper covers, but spelling it out here would be redundant).
 */
export function useDeleteAMATag(guildId: string, amaId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (tagId: number) => apiFetch('delete', `/v3/guilds/${guildId}/ama/amas/${amaId}/tags/${tagId}`),
		async onSuccess() {
			await invalidateAMAQuestions(queryClient, guildId, amaId);
		},
	});
}

/**
 * Shared by this hook and the route's server-side fetch (`app/ama-answers/[shareToken]/_lib/publicAnswers.ts`),
 * which needs to hit the same endpoint from `generateMetadata` to build the link embed (#295).
 */
export function publicAMAAnswersPath(shareToken: string): string {
	return `/v3/ama/public/${shareToken}`;
}

export function usePublicAMAAnswers(shareToken: string) {
	return useQuery({
		queryKey: queryKeys.ama.publicAnswers(shareToken),
		queryFn: async () => apiFetch<PublicAMAAnswersResult>('get', publicAMAAnswersPath(shareToken)),
	});
}
