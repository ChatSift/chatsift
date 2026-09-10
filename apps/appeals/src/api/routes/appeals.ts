import type {
	AppealsMeResponse,
	CheckGuildResult,
	InferRouteContract,
	ListMyAppealsResult,
	PublicAppeal,
	ResolveInviteResult,
	submitAppealRoute,
} from '@chatsift/api';
import { APIError } from '@chatsift/web-core/api/error';
import { apiFetch } from '@chatsift/web-core/api/fetch';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryClient';

type SubmitAppealContract = InferRouteContract<typeof submitAppealRoute>;
export type SubmitAppealBody = SubmitAppealContract['body'];

export const me = {
	queryKey: () => queryKeys.me,
	// A 401 is "not signed in", not a failure -- resolved to `null` so callers can tell it apart from "still
	// loading" (`undefined`) without inspecting the query's error, same as the dashboard's `me`.
	queryFn: async (): Promise<AppealsMeResponse | null> => {
		try {
			return await apiFetch<AppealsMeResponse>('get', '/v3/appeals/auth/me');
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 401) {
				return null;
			}

			throw error;
		}
	},
};

export function useMe() {
	return useQuery({ queryKey: me.queryKey(), queryFn: me.queryFn });
}

export function useLogout() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => apiFetch('post', '/v3/appeals/auth/logout'),
		onSuccess() {
			// Set directly rather than invalidated, for the reason the dashboard's `useLogout` spells out: only
			// actively-observed queries refetch on invalidation, and `setQueryData` notifies every observer
			// immediately. Everything else is dropped so a later sign-in as a different account cannot see this
			// one's guilds or appeals.
			queryClient.setQueryData(me.queryKey(), null);
			queryClient.removeQueries({ predicate: (query) => query.queryKey[1] !== 'me' });
		},
	});
}

/**
 * `enabled` is how the caller says "we know there is a session". Every appellant-facing route is behind
 * `isAppealsAuthed`, so firing this while signed out only produces a 401 to render a login prompt underneath --
 * and, worse, one that trips the query client's `onUnauthorized`.
 */
export function useAppealsGuild(guildId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.guild(guildId),
		enabled,
		queryFn: async () => apiFetch<CheckGuildResult>('get', `/v3/appeals/guilds/${guildId}`),
	});
}

/**
 * Resolves an invite code to a guild id (decision 12 -- swap `discord.gg` for `unban.app`). `null` for a code
 * that is expired, was never real, or belongs to a server that does not use Appeals: the API answers all three
 * with a 404 on purpose, so this route never becomes a way to ask whether an arbitrary invite still works.
 */
export function useResolveInvite(code: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.invite(code),
		enabled,
		retry: false,
		queryFn: async (): Promise<ResolveInviteResult | null> => {
			try {
				return await apiFetch<ResolveInviteResult>('get', `/v3/appeals/invites/${encodeURIComponent(code)}`);
			} catch (error) {
				if (error instanceof APIError && error.statusCode === 404) {
					return null;
				}

				throw error;
			}
		},
	});
}

export function useMyAppeals(enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.mine,
		enabled,
		queryFn: async () => apiFetch<ListMyAppealsResult>('get', '/v3/appeals/mine'),
	});
}

export function useSubmitAppeal(guildId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (body: SubmitAppealBody) =>
			apiFetch<PublicAppeal>('post', `/v3/appeals/guilds/${guildId}/appeals`, { body }),
		async onSuccess() {
			// Both views change: the guild page flips to "under review", and the appeal joins their list. Refetched
			// rather than patched from the response, which carries no guild summary of its own.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.guild(guildId) }),
				queryClient.invalidateQueries({ queryKey: queryKeys.mine }),
			]);
		},
	});
}

/**
 * Where the API's OAuth handshake starts. A full navigation rather than a fetch: the flow ends in a redirect
 * back to `redirectTo` on this origin, and `redirect_to` is re-validated server-side against `unban.app`'s own
 * origin and its short path allowlist (`sanitizeAppealsRedirectTo`), so a crafted value cannot bounce anybody
 * off-site.
 */
export function loginHref(redirectTo: string): string {
	const api = process.env['NEXT_PUBLIC_API_URL']!;
	return `${api}/v3/appeals/auth/discord?redirect_to=${encodeURIComponent(redirectTo)}`;
}

export {
	type AppealsMeResponse,
	type CheckGuildResult,
	type ListMyAppealsResult,
	type PublicAppeal,
} from '@chatsift/api';
