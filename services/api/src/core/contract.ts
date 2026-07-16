import type { HttpMethod, RouteDefinition } from './route.js';

/**
 * Extracts the contract (types) from a RouteDefinition for frontend usage.
 */
export type InferRouteContract<TRoute> =
	TRoute extends RouteDefinition<
		infer TMethod,
		infer TPath,
		infer TBody,
		infer TQuery,
		infer TParams,
		infer TResponse,
		infer _TMiddlewares
	>
		? {
				body: TBody;
				method: TMethod extends HttpMethod ? TMethod : never;
				params: TParams;
				path: TPath extends string ? TPath : never;
				query: TQuery;
				response: TResponse;
			}
		: never;
