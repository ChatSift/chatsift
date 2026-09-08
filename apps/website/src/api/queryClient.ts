import { makeQueryClient } from '@chatsift/web-core/api/queryClient';
import { isServer, type QueryClient } from '@tanstack/react-query';

/**
 * Hoisted out of `queryKeys` below purely so `getBrowserQueryClient`'s `onUnauthorized` can reference it
 * without reading a `const` declared further down the file. `queryKeys.auth.me` is still how this is spelled
 * everywhere else -- it's the same tuple, not a second source of truth.
 */
const meQueryKey = ['api', 'auth', 'me'] as const;

let _browserQueryClient: QueryClient | undefined;

/**
 * For use in "use client" Providers -- returns a singleton on the browser, and a fresh instance on each SSR
 * pass (to avoid cross-request state sharing).
 */
export function getBrowserQueryClient(): QueryClient {
	if (isServer) {
		return makeClient();
	}

	return (_browserQueryClient ??= makeClient());
}

function makeClient(): QueryClient {
	return makeQueryClient({
		onUnauthorized: (query) => {
			// `me.queryFn` deliberately resolves a 401 to `null` instead of throwing, so without this the `me`
			// entry keeps serving its cached, logged-in user -- the navbar stays signed in while every page-level
			// query renders `UserErrorHandler`'s inline "Log in" button underneath it, and `NavGateProvider`'s
			// redirect never fires because it gates on `user === null`. Writing that `null` here is what hands the
			// expiry back to `NavGateProvider`.
			//
			// The `me` query is excluded (it can't 401 anyway, per above) so this can never recurse, and skipped on
			// the server, where each SSR pass gets a throwaway client that nothing observes.
			if (!isServer && query.queryKey[1] !== 'auth') {
				getBrowserQueryClient().setQueryData(meQueryKey, null);
			}
		},
	});
}

/**
 * Hierarchical query keys.
 * Use the `.all` arrays for broad invalidation, and the more specific helpers for individual cache entries.
 */
export const queryKeys = {
	all: ['api'] as const,
	auth: {
		all: ['api', 'auth'] as const,
		me: meQueryKey,
	},
	guilds: {
		info: (guildId: string, forBot: string) => ['api', 'guilds', guildId, 'info', forBot] as const,
	},
	experiments: {
		all: ['api', 'experiments'] as const,
	},
	grants: {
		all: (guildId: string) => ['api', 'grants', guildId] as const,
	},
	ama: {
		all: (guildId: string) => ['api', 'ama', guildId] as const,
		list: (guildId: string, includeEnded: boolean) => ['api', 'ama', guildId, 'list', includeEnded] as const,
		byId: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId] as const,
		stats: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId, 'stats'] as const,
		tags: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId, 'tags'] as const,
		questions: {
			all: (guildId: string, amaId: string) => ['api', 'ama', guildId, amaId, 'questions'] as const,
			list: (
				guildId: string,
				amaId: string,
				states: string | undefined,
				tagId: number | undefined,
				authorId: string | undefined,
				q: string,
			) => ['api', 'ama', guildId, amaId, 'questions', 'list', states, tagId, authorId, q] as const,
			byId: (guildId: string, amaId: string, questionId: number) =>
				['api', 'ama', guildId, amaId, 'questions', questionId] as const,
		},
		publicAnswers: (shareToken: string) => ['api', 'ama', 'public', shareToken] as const,
	},
	modmail: {
		all: (guildId: string) => ['api', 'modmail', guildId] as const,
		config: (guildId: string) => ['api', 'modmail', guildId, 'config'] as const,
		categories: (guildId: string) => ['api', 'modmail', guildId, 'categories'] as const,
		panels: (guildId: string) => ['api', 'modmail', guildId, 'panels'] as const,
		snippets: (guildId: string) => ['api', 'modmail', guildId, 'snippets'] as const,
		snippetUpdates: (guildId: string, snippetId: number) =>
			['api', 'modmail', guildId, 'snippets', snippetId, 'updates'] as const,
		blocks: (guildId: string) => ['api', 'modmail', guildId, 'blocks'] as const,
		threads: {
			all: (guildId: string) => ['api', 'modmail', guildId, 'threads'] as const,
			list: (guildId: string, includeClosed: boolean, q: string, categoryId: number | undefined) =>
				['api', 'modmail', guildId, 'threads', 'list', includeClosed, q, categoryId] as const,
			byId: (guildId: string, threadId: string) => ['api', 'modmail', guildId, 'threads', threadId] as const,
			messageEdits: (guildId: string, threadId: string, messageId: number) =>
				['api', 'modmail', guildId, 'threads', threadId, 'messages', messageId, 'edits'] as const,
		},
	},
	social: {
		all: (guildId: string) => ['api', 'social', guildId] as const,
		config: (guildId: string) => ['api', 'social', guildId, 'config'] as const,
		channels: (guildId: string) => ['api', 'social', guildId, 'channels'] as const,
		roles: (guildId: string) => ['api', 'social', guildId, 'roles'] as const,
		rewards: (guildId: string) => ['api', 'social', guildId, 'rewards'] as const,
		interactions: (guildId: string) => ['api', 'social', guildId, 'interactions'] as const,
		leaderboard: (guildId: string) => ['api', 'social', guildId, 'leaderboard'] as const,
		leaderboardPage: (guildId: string, offset: number) => ['api', 'social', guildId, 'leaderboard', offset] as const,
		publicLeaderboard: (guildId: string) => ['api', 'social', 'public', guildId, 'leaderboard'] as const,
		publicLeaderboardPage: (guildId: string, offset: number) =>
			['api', 'social', 'public', guildId, 'leaderboard', offset] as const,
	},
	automoderator: {
		all: (guildId: string) => ['api', 'automoderator', guildId] as const,
		config: (guildId: string) => ['api', 'automoderator', guildId, 'config'] as const,
		cases: {
			list: (
				guildId: string,
				filters: { action?: string | undefined; includePardoned: boolean; targetId?: string | undefined },
			) => ['api', 'automoderator', guildId, 'cases', filters] as const,
			byId: (guildId: string, caseId: number) => ['api', 'automoderator', guildId, 'cases', caseId] as const,
			// Prefix for invalidating every case query in a guild at once, list filters included.
			all: (guildId: string) => ['api', 'automoderator', guildId, 'cases'] as const,
		},
		logChannels: (guildId: string) => ['api', 'automoderator', guildId, 'log-channels'] as const,
		logExemptions: (guildId: string) => ['api', 'automoderator', guildId, 'log-exemptions'] as const,
		reports: {
			list: (guildId: string, filters: { state?: string | undefined; targetId?: string | undefined }) =>
				['api', 'automoderator', guildId, 'reports', filters] as const,
			byId: (guildId: string, reportId: number) => ['api', 'automoderator', guildId, 'reports', reportId] as const,
			all: (guildId: string) => ['api', 'automoderator', guildId, 'reports'] as const,
		},
		reportPresets: (guildId: string) => ['api', 'automoderator', guildId, 'report-presets'] as const,
		reportPrompts: (guildId: string) => ['api', 'automoderator', guildId, 'report-prompts'] as const,
		warnPunishments: (guildId: string) => ['api', 'automoderator', guildId, 'warn-punishments'] as const,
		automodRules: (guildId: string) => ['api', 'automoderator', guildId, 'automod-rules'] as const,
		banwordPolicies: (guildId: string) => ['api', 'automoderator', guildId, 'banword-policies'] as const,
		bypassRoles: (guildId: string) => ['api', 'automoderator', guildId, 'bypass-roles'] as const,
		allowedUrls: (guildId: string) => ['api', 'automoderator', guildId, 'allowed-urls'] as const,
		allowedInvites: (guildId: string) => ['api', 'automoderator', guildId, 'allowed-invites'] as const,
		filterExemptions: (guildId: string) => ['api', 'automoderator', guildId, 'filter-exemptions'] as const,
		triggerPunishments: (guildId: string) => ['api', 'automoderator', guildId, 'trigger-punishments'] as const,
	},
} as const;
