import type { InferRouteBody, InferRouteMethod, InferRouteResult, RouteMethod } from '../route.js';
import type * as routes from '../routes.js';

type Narrow<Narrowed, Narowee> = Narrowed extends Narowee ? Narrowed : never;
type ConstructorToType<TConstructor> = TConstructor extends new (...args: any[]) => infer T ? T : never;
type RoutesByClass = {
	[K in keyof typeof routes]: ConstructorToType<(typeof routes)[K]>;
};
type RoutesByPath = {
	[Path in RoutesByClass[keyof RoutesByClass]['info']['path']]: Narrow<
		RoutesByClass[keyof RoutesByClass],
		{ info: { path: Path } }
	>;
};

interface RouteMethodMap {
	[RouteMethod.get]: 'GET';
	[RouteMethod.post]: 'POST';
	[RouteMethod.put]: 'PUT';
	[RouteMethod.delete]: 'DELETE';
	[RouteMethod.patch]: 'PATCH';
}

export type { ParseHTTPParameters } from '../route.js';

export type APIRoutes = {
	[Path in keyof RoutesByPath]: {
		[Method in RouteMethodMap[InferRouteMethod<RoutesByPath[Path]>]]: Narrow<
			RoutesByPath[Path],
			{ info: { method: Lowercase<Method> } }
		>;
	};
};

// TODO: Look into Date -> string

export type InferAPIRouteBody<TPath extends keyof APIRoutes, TMethod extends keyof APIRoutes[TPath]> = InferRouteBody<
	APIRoutes[TPath][TMethod]
>;

export type InferAPIRouteResult<
	TPath extends keyof APIRoutes,
	TMethod extends keyof APIRoutes[TPath],
> = InferRouteResult<APIRoutes[TPath][TMethod]>;
