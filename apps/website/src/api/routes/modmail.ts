import type {
	InferRouteContract,
	createModmailCategoryRoute,
	createModmailPanelRoute,
	createModmailSnippetRoute,
	getModmailConfigRoute,
	getModmailSnippetUpdatesRoute,
	listModmailBlocksRoute,
	listModmailCategoriesRoute,
	listModmailPanelsRoute,
	listModmailSnippetsRoute,
	resyncModmailPanelsRoute,
	resyncModmailSnippetsRoute,
	updateModmailCategoryRoute,
	updateModmailConfigRoute,
	updateModmailPanelRoute,
	updateModmailSnippetRoute,
} from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';
import { useGuildInfo } from './guilds';

type GetModmailConfigContract = InferRouteContract<typeof getModmailConfigRoute>;
export type ModmailConfig = GetModmailConfigContract['response'];

type UpdateModmailConfigContract = InferRouteContract<typeof updateModmailConfigRoute>;
export type UpdateModmailConfigBody = UpdateModmailConfigContract['body'];

export function useModmailConfig(guildId: string) {
	return useQuery({
		queryKey: queryKeys.modmail.config(guildId),
		queryFn: async () => apiFetch<ModmailConfig>('get', `/v3/guilds/${guildId}/modmail/config`),
	});
}

export function useUpdateModmailConfig(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateModmailConfigBody) =>
			apiFetch<ModmailConfig>('patch', `/v3/guilds/${guildId}/modmail/config`, { body }),
		async onSuccess(data) {
			queryClient.setQueryData(queryKeys.modmail.config(guildId), data);
		},
	});
}

type ListModmailCategoriesContract = InferRouteContract<typeof listModmailCategoriesRoute>;
export type ModmailCategory = ListModmailCategoriesContract['response'][number];

type CreateModmailCategoryContract = InferRouteContract<typeof createModmailCategoryRoute>;
export type CreateModmailCategoryBody = CreateModmailCategoryContract['body'];

type UpdateModmailCategoryContract = InferRouteContract<typeof updateModmailCategoryRoute>;
export type UpdateModmailCategoryBody = UpdateModmailCategoryContract['body'];

export function useModmailCategories(guildId: string) {
	return useQuery({
		queryKey: queryKeys.modmail.categories(guildId),
		queryFn: async () => apiFetch<ModmailCategory[]>('get', `/v3/guilds/${guildId}/modmail/categories`),
	});
}

export function useCreateModmailCategory(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateModmailCategoryBody) =>
			apiFetch<ModmailCategory>('post', `/v3/guilds/${guildId}/modmail/categories`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.categories(guildId) });
		},
	});
}

export function useUpdateModmailCategory(guildId: string, categoryId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateModmailCategoryBody) =>
			apiFetch<ModmailCategory>('patch', `/v3/guilds/${guildId}/modmail/categories/${categoryId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.categories(guildId) });
		},
	});
}

export function useDeleteModmailCategory(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (categoryId: number) =>
			apiFetch('delete', `/v3/guilds/${guildId}/modmail/categories/${categoryId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.categories(guildId) });
		},
	});
}

/**
 * Bulk `sortOrder` patch used by the categories list's move-up/move-down controls -- `CategoriesList` recomputes
 * every category's sequential position after a move (see there for why) and hands the ones that actually changed
 * here, rather than the per-category `useUpdateModmailCategory` hook (awkward to instantiate for an id decided
 * only at click-time, and this needs to update more than one category at once anyway).
 */
export function useReorderModmailCategories(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (updates: { categoryId: number; sortOrder: number }[]) => {
			await Promise.all(
				updates.map(async ({ categoryId, sortOrder }) =>
					apiFetch<ModmailCategory>('patch', `/v3/guilds/${guildId}/modmail/categories/${categoryId}`, {
						body: { sortOrder },
					}),
				),
			);
		},
		// `onSettled` (not `onSuccess`) -- a partial failure (some PATCHes landed before one rejected and aborted
		// the rest) still needs a refetch, otherwise the list keeps showing the pre-reorder `sortOrder` values
		// mixed with whichever ones happened to persist, silently diverging from the DB.
		async onSettled() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.categories(guildId) });
		},
	});
}

/**
 * Resolves the mod forum's configured tags (Discord `available_tags`) for the category form's forum-tag picker.
 * `undefined` `tags` (as opposed to `[]`) specifically means "no mod forum configured yet" vs. "configured, but
 * has no tags" -- the picker renders different guidance for each.
 */
export function useModForumTags(guildId: string) {
	const { data: config, isLoading: isConfigLoading } = useModmailConfig(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'MODMAIL');

	const modForumChannel = config?.modForumId
		? guildInfo?.channels.find((channel) => channel.id === config.modForumId)
		: undefined;

	return {
		isLoading: isConfigLoading || isGuildInfoLoading,
		modForumConfigured: Boolean(config?.modForumId),
		tags: modForumChannel?.availableTags,
	};
}

type ListModmailPanelsContract = InferRouteContract<typeof listModmailPanelsRoute>;
export type ModmailPanel = ListModmailPanelsContract['response'][number];

type CreateModmailPanelContract = InferRouteContract<typeof createModmailPanelRoute>;
export type CreateModmailPanelBody = CreateModmailPanelContract['body'];

type UpdateModmailPanelContract = InferRouteContract<typeof updateModmailPanelRoute>;
export type UpdateModmailPanelBody = UpdateModmailPanelContract['body'];

export function useModmailPanels(guildId: string) {
	return useQuery({
		queryKey: queryKeys.modmail.panels(guildId),
		queryFn: async () => apiFetch<ModmailPanel[]>('get', `/v3/guilds/${guildId}/modmail/panels`),
	});
}

export function useCreateModmailPanel(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateModmailPanelBody) =>
			apiFetch<ModmailPanel>('post', `/v3/guilds/${guildId}/modmail/panels`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.panels(guildId) });
		},
	});
}

export function useUpdateModmailPanel(guildId: string, panelId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateModmailPanelBody) =>
			apiFetch<ModmailPanel>('patch', `/v3/guilds/${guildId}/modmail/panels/${panelId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.panels(guildId) });
		},
	});
}

export function useDeleteModmailPanel(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (panelId: number) => apiFetch('delete', `/v3/guilds/${guildId}/modmail/panels/${panelId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.panels(guildId) });
		},
	});
}

type ListModmailSnippetsContract = InferRouteContract<typeof listModmailSnippetsRoute>;
export type ModmailSnippet = ListModmailSnippetsContract['response'][number];

type CreateModmailSnippetContract = InferRouteContract<typeof createModmailSnippetRoute>;
export type CreateModmailSnippetBody = CreateModmailSnippetContract['body'];

type UpdateModmailSnippetContract = InferRouteContract<typeof updateModmailSnippetRoute>;
export type UpdateModmailSnippetBody = UpdateModmailSnippetContract['body'];

type GetModmailSnippetUpdatesContract = InferRouteContract<typeof getModmailSnippetUpdatesRoute>;
export type ModmailSnippetRevisionsResult = GetModmailSnippetUpdatesContract['response'];
export type ModmailSnippetRevision = ModmailSnippetRevisionsResult['revisions'][number];

export function useModmailSnippets(guildId: string) {
	return useQuery({
		queryKey: queryKeys.modmail.snippets(guildId),
		queryFn: async () => apiFetch<ModmailSnippet[]>('get', `/v3/guilds/${guildId}/modmail/snippets`),
	});
}

/**
 * A snippet's edit history (#324). Unlike `useModmailMessageEdits`' lazy `enabled` gate, this fetches
 * eagerly -- there's exactly one history panel on the edit page, not one per row of a long list, so
 * there's no fan-out to defer and the panel is visible as soon as the page settles.
 */
export function useModmailSnippetRevisions(guildId: string, snippetId: number) {
	return useQuery({
		queryKey: queryKeys.modmail.snippetUpdates(guildId, snippetId),
		queryFn: async () =>
			apiFetch<ModmailSnippetRevisionsResult>('get', `/v3/guilds/${guildId}/modmail/snippets/${snippetId}/updates`),
	});
}

export function useCreateModmailSnippet(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: CreateModmailSnippetBody) =>
			apiFetch<ModmailSnippet>('post', `/v3/guilds/${guildId}/modmail/snippets`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.snippets(guildId) });
		},
	});
}

export function useUpdateModmailSnippet(guildId: string, snippetId: number) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: UpdateModmailSnippetBody) =>
			apiFetch<ModmailSnippet>('patch', `/v3/guilds/${guildId}/modmail/snippets/${snippetId}`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.snippets(guildId) });
		},
	});
}

export function useDeleteModmailSnippet(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (snippetId: number) => apiFetch('delete', `/v3/guilds/${guildId}/modmail/snippets/${snippetId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.snippets(guildId) });
		},
	});
}

type ListModmailBlocksContract = InferRouteContract<typeof listModmailBlocksRoute>;
export type ModmailBlock = ListModmailBlocksContract['response'][number];

export function useModmailBlocks(guildId: string) {
	return useQuery({
		queryKey: queryKeys.modmail.blocks(guildId),
		queryFn: async () => apiFetch<ModmailBlock[]>('get', `/v3/guilds/${guildId}/modmail/blocks`),
	});
}

export function useDeleteModmailBlock(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (userId: string) =>
			apiFetch('delete', `/v3/guilds/${guildId}/modmail/blocks`, { body: { userId } }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.blocks(guildId) });
		},
	});
}

type ResyncModmailSnippetsContract = InferRouteContract<typeof resyncModmailSnippetsRoute>;
export type ResyncModmailSnippetsResult = ResyncModmailSnippetsContract['response'];

type ResyncModmailPanelsContract = InferRouteContract<typeof resyncModmailPanelsRoute>;
export type ResyncModmailPanelsResult = ResyncModmailPanelsContract['response'];

export type ResyncFailure = ResyncModmailSnippetsResult['failures'][number];

/**
 * #216 P6, split per-surface in #331 -- these reconcile snippet commands (and panel messages, respectively)
 * against whichever application currently owns `guildId`, for use after a custom-instance swap (see
 * docs/roadmap/01-architecture.md §8). Each refetches only its own list on success, since a recreated
 * command/reposted panel changes that row's `commandId`/`messageId` and the list views don't otherwise know
 * to refresh.
 */
export function useResyncModmailSnippets(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<ResyncModmailSnippetsResult>('post', `/v3/guilds/${guildId}/modmail/snippets/resync`, { body: {} }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.snippets(guildId) });
		},
	});
}

export function useResyncModmailPanels(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			apiFetch<ResyncModmailPanelsResult>('post', `/v3/guilds/${guildId}/modmail/panels/resync`, { body: {} }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.modmail.panels(guildId) });
		},
	});
}
