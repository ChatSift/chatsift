import type { NextHandler, Request, Response } from 'polka';
import type { z } from 'zod';

declare module 'polka' {
	interface Request {
		trackingId: string;
	}
}

export type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

export interface RouteSchema<TBody, TQuery, TParams, TResponse> {
	body?: z.ZodType<TBody>;
	params?: z.ZodType<TParams>;
	query?: z.ZodType<TQuery>;
	response?: z.ZodType<TResponse>;
}

export type TypedRequest<TBody, TQuery, TParams> = Omit<Request, 'body' | 'params' | 'query'> & {
	body: TBody;
	params: TParams;
	query: TQuery;
	trackingId: string;
};

type UnionToIntersection<TUnion> = (TUnion extends unknown ? (arg: TUnion) => void : never) extends (
	arg: infer TIntersection,
) => void
	? TIntersection
	: never;

/**
 * The intersected augmentation type produced by a list of typed middlewares.
 * An empty list resolves to `{}`, which is invisible when intersected onto `TypedRequest`.
 */
export type MiddlewareContext<TMiddlewares extends readonly TypedMiddleware<object>[]> = UnionToIntersection<
	| { [K in keyof TMiddlewares]: TMiddlewares[K] extends TypedMiddleware<infer TExtra> ? TExtra : never }[number]
	| Record<never, never>
>;

/**
 * A typed middleware. `TExtra` declares what the middleware attaches to `req`,
 * making those fields available in the route handler's typed request.
 */
export interface TypedMiddleware<TExtra extends object = Record<never, never>> {
	_extra?: TExtra; // phantom type carrier — never populated at runtime
	handle(req: Request, res: Response, next: NextHandler): Promise<void> | void;
}

/**
 * Unwraps a `TypedMiddleware` into a plain, bound polka `Middleware` function. Used at call sites still on the
 * old `Route` class (which wants `Middleware[]`, not `TypedMiddleware[]`) until they're migrated to `defineRoute`.
 *
 * Deliberately not generic over `TExtra`: a heterogeneous `TypedMiddleware<...>[]` tuple (e.g. `isAuthed`'s
 * multi-element returns) would otherwise force a single `TExtra` instantiation across the whole `.map()` call,
 * which doesn't typecheck. `TExtra` only documents what a middleware attaches to `req` — it has no bearing on
 * `handle`'s runtime signature, so widening it here is safe.
 */
export function unwrapMiddlewareHandle(middleware: TypedMiddleware<any>): TypedMiddleware<any>['handle'] {
	return middleware.handle.bind(middleware);
}

/**
 * Creates a typed middleware. Pass `TExtra` as an explicit type argument to declare
 * what this middleware attaches to `req`.
 *
 * @example
 * ```ts
 * const requireAuth = defineMiddleware<{ userId: string }>(async (req, _res, next) => {
 *   const token = req.headers['authorization'];
 *   if (!token) return next(new Boom('Unauthorized', { statusCode: 401 }));
 *   Reflect.set(req, 'userId', parseToken(token));
 *   next();
 * });
 * ```
 */
export function defineMiddleware<TExtra extends object = Record<never, never>>(
	handle: (req: Request, res: Response, next: NextHandler) => Promise<void> | void,
): TypedMiddleware<TExtra> {
	return { handle };
}

export interface RouteDefinition<
	TMethod extends HttpMethod,
	TPath extends string,
	TBody,
	TQuery,
	TParams,
	TResponse,
	TMiddlewares extends readonly TypedMiddleware<object>[] = [],
> {
	handler(
		req: MiddlewareContext<TMiddlewares> & TypedRequest<TBody, TQuery, TParams>,
		res: Response,
	): Promise<TResponse> | TResponse;
	method: TMethod;
	middleware?: TMiddlewares;
	path: TPath;
	schema?: RouteSchema<TBody, TQuery, TParams, TResponse>;
}

/**
 * Defines a strongly-typed route, preserving method and path as literal types.
 */
export function defineRoute<
	TMethod extends HttpMethod,
	TPath extends string,
	TMiddlewares extends readonly TypedMiddleware<object>[] = [],
	TBody = unknown,
	TQuery = unknown,
	TParams = unknown,
	TResponse = void,
>(
	config: RouteDefinition<TMethod, TPath, TBody, TQuery, TParams, TResponse, TMiddlewares>,
): RouteDefinition<TMethod, TPath, TBody, TQuery, TParams, TResponse, TMiddlewares> {
	return config;
}
