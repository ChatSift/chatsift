import type { Logger } from '@chatsift/backend-core';
import type { NextHandler, Request, Response } from 'polka';
import type { z } from 'zod';

declare module 'polka' {
	interface Request {
		/**
		 * Per-request child logger bound to a `requestId`, attached by `attachLogger()` as the very first
		 * `.use()` middleware in `app.ts` -- ahead of cors/helmet/etc -- so it's present for as much of the
		 * request lifecycle as polka allows, including unmatched routes and errors thrown by other `.use()`
		 * middleware. See `middleware/attachLogger.ts` for the one edge case where it can still be missing.
		 */
		logger: Logger;
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
	/**
	 * If set, `mountRoute` computes a WS gateway channel from the request after this route's handler completes
	 * successfully (2xx) and broadcasts a bare `{ type: 'invalidate' }` signal to it (`services/api/src/ws`) --
	 * one hook point instead of a broadcast call at every early-return branch inside the handler itself. Return
	 * `undefined` to skip broadcasting for a particular request. Channel-name builders live in `@chatsift/core`'s
	 * `realtimeChannels.ts` so the frontend subscribes to the exact same string.
	 *
	 * An array broadcasts to each channel in turn, for the mutations whose result shows up in more than one
	 * audience's view of the data -- an AMA answer, say, lands on both the dashboard's `amaQuestionsChannel` and
	 * the public page's `amaPublicAnswersChannel` (#323).
	 */
	realtimeChannel?(
		req: MiddlewareContext<TMiddlewares> & TypedRequest<TBody, TQuery, TParams>,
	): string[] | string | undefined;
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
