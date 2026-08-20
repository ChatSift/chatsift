import type {
	InferRouteContract,
	listAutomodRulesRoute,
	listBanwordPoliciesRoute,
	setBanwordPolicyRoute,
} from '@chatsift/api';
import type { banwordActionSchema } from '@chatsift/api/automoderator-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../fetch';
import { queryKeys } from '../queryClient';

type RulesContract = InferRouteContract<typeof listAutomodRulesRoute>;
export type AutomodRulesResult = RulesContract['response'];
export type AutomodRule = Extract<AutomodRulesResult, { available: true }>['rules'][number];

type ListContract = InferRouteContract<typeof listBanwordPoliciesRoute>;
export type BanwordPolicies = ListContract['response'];
export type BanwordPolicy = BanwordPolicies[number];

type SetContract = InferRouteContract<typeof setBanwordPolicyRoute>;
export type SetBanwordPolicyBody = SetContract['body'];

export type BanwordActionName = (typeof banwordActionSchema.options)[number];

/**
 * The guild's native AutoMod rules, read through the bot's token.
 *
 * Answers with a discriminated `available` rather than failing, because "the bot doesn't hold Manage Server"
 * and "the guild has no rules" are ordinary states with different fixes -- see the route's own comment.
 *
 * `staleTime: 0` (the default) on purpose: this is configuration a manager may have changed in Discord's own
 * UI seconds ago, in another tab, which is exactly the workflow the read-only design forces on them.
 */
export function useAutomodRules(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.automodRules(guildId),
		queryFn: async () => apiFetch<AutomodRulesResult>('get', `/v3/guilds/${guildId}/automoderator/automod-rules`),
	});
}

export function useBanwordPolicies(guildId: string) {
	return useQuery({
		queryKey: queryKeys.automoderator.banwordPolicies(guildId),
		queryFn: async () => apiFetch<BanwordPolicies>('get', `/v3/guilds/${guildId}/automoderator/banword-policies`),
	});
}

export function useSetBanwordPolicy(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: SetBanwordPolicyBody) =>
			apiFetch<BanwordPolicy>('put', `/v3/guilds/${guildId}/automoderator/banword-policies`, { body }),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.banwordPolicies(guildId) });
		},
	});
}

export function useDeleteBanwordPolicy(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (policyId: number) =>
			apiFetch('delete', `/v3/guilds/${guildId}/automoderator/banword-policies/${policyId}`),
		async onSuccess() {
			await queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.banwordPolicies(guildId) });
		},
	});
}
