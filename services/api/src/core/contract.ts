import type { HttpMethod, RouteDefinition } from './route.js';

/**
 * Mirrors what `JSON.stringify`/`JSON.parse` actually do to a handler's return value on the wire: `Date` becomes an
 * ISO string, everything else recurses structurally. Without this, a route returning a DB row typed with
 * `createdAt: Date` would have `InferRouteContract` promise a `Date` to the frontend when the real response body
 * only ever contains a string — see the route-migration checklist in docs/roadmap/02-foundation.md Part C.
 *
 * The primitive branch must come before the `object` branch: a branded id type (e.g. `number & { __brand: ... }`,
 * as kanel generates in `@chatsift/db`) is structurally assignable to `object` in a conditional type, so checking
 * `extends object` first would incorrectly explode it into a mapped type over its (nonexistent, phantom) keys
 * instead of leaving it as the primitive it actually is at runtime.
 */
export type Serialized<TValue> = TValue extends Date
	? string
	: TValue extends bigint | boolean | number | string | symbol | null | undefined
		? TValue
		: TValue extends (infer TItem)[]
			? Serialized<TItem>[]
			: TValue extends object
				? { [TKey in keyof TValue]: Serialized<TValue[TKey]> }
				: TValue;

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
				response: Serialized<TResponse>;
			}
		: never;
