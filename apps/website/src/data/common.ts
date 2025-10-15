import type {
	APIRoutes,
	GetAMAsQuery,
	GetAuthMeQuery,
	GetGuildQuery,
	InferAPIRouteBodyOrQuery,
	ParseHTTPParameters,
} from '@chatsift/api';

type Narrow<Narrowed, Narowee> = Narrowed extends Narowee ? Narrowed : never;
export type GettableRoutes = Narrow<APIRoutes[keyof APIRoutes], { GET: any }>['GET']['info']['path'];

export type MakeOptions<Path extends keyof APIRoutes = keyof APIRoutes> = Path extends GettableRoutes
	? {
			readonly params: { [ParameterName in ParseHTTPParameters<Path>[number]]: string };
			readonly path: Path;
			// @ts-expect-error - This won't ever compile
			readonly query: InferAPIRouteBodyOrQuery<Path, 'GET'>;
			readonly queryKey: readonly [string, ...string[]];
		}
	: {
			readonly params: { [ParameterName in ParseHTTPParameters<Path>[number]]: string };
			readonly path: Path;
			readonly queryKey: readonly [string, ...string[]];
		};

interface Info {
	readonly [Key: string]:
		| Info
		| MakeOptions
		| ((...params: any[]) => Info | MakeOptions | (Info & MakeOptions))
		| (Info & MakeOptions);
}

export const routesInfo = {
	auth: {
		me: (query: GetAuthMeQuery) => ({
			queryKey: ['auth', 'me'],
			path: '/v3/auth/me',
			query,
			params: {},
		}),

		logout: {
			queryKey: ['auth', 'logout'],
			path: '/v3/auth/logout',
			params: {},
		},
	},

	guilds: (guildId: string) => ({
		info: (query: GetGuildQuery) => ({
			queryKey: ['guilds', guildId],
			path: '/v3/guilds/:guildId',
			query,
			params: { guildId },
		}),

		grants: {
			queryKey: ['guilds', guildId, 'grants'],
			path: '/v3/guilds/:guildId/grants',
			query: {} as never,
			params: { guildId },
		},

		ama: {
			amas: (query?: GetAMAsQuery) => ({
				queryKey: ['guilds', guildId, 'ama', 'amas', query?.include_ended ?? 'false'],
				path: '/v3/guilds/:guildId/ama/amas',
				query: { include_ended: query?.include_ended ?? 'false' },
				params: { guildId },
			}),

			ama: (amaId: string) => ({
				queryKey: ['guilds', guildId, 'ama', 'ama', amaId],
				path: '/v3/guilds/:guildId/ama/amas/:amaId',
				query: {},
				params: { guildId, amaId },
			}),

			updateAMA: (amaId: string) => ({
				queryKey: ['guilds', guildId, 'ama', 'amas', amaId, 'update'],
				path: '/v3/guilds/:guildId/ama/amas/:amaId',
				query: {},
				params: { guildId, amaId },
			}),

			repostPrompt: (amaId: string) => ({
				queryKey: ['guilds', guildId, 'ama', 'amas', amaId, 'prompt'],
				path: '/v3/guilds/:guildId/ama/amas/:amaId/prompt',
				query: {},
				params: { guildId, amaId },
			}),
		},
	}),
} as const satisfies Info;
