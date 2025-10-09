import type {
	APIRoutes,
	GetAMAsQuery,
	GetAuthMeQuery,
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
		},
	},

	guilds: (id: string) => ({
		ama: {
			amas: (query: GetAMAsQuery) => ({
				queryKey: ['guilds', id, 'ama', 'amas', String(query.include_ended)],
				path: '/v3/guilds/:id/ama/amas',
				query,
				params: { id },
			}),
		},
	}),
} as const satisfies Info;
