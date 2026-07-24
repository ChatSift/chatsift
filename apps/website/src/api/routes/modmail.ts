import type {
	InferRouteContract,
	createModmailCategoryRoute,
	getModmailConfigRoute,
	listModmailCategoriesRoute,
	updateModmailCategoryRoute,
	updateModmailConfigRoute,
} from '@chatsift/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

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
