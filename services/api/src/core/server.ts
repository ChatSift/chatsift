import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { publishRealtimeInvalidate } from '@chatsift/backend-core';
import { RealtimeClientIdHeader } from '@chatsift/core';
import { badRequest } from '@hapi/boom';
import type { Middleware, Polka } from 'polka';
import { ZodError } from 'zod';
import { jsonParser } from '../middleware/jsonParser.js';
import { httpRequestDuration } from './metrics.js';
import type { HttpMethod, MiddlewareContext, RouteDefinition, TypedMiddleware, TypedRequest } from './route.js';

/**
 * Mounts a `defineRoute` definition onto a Polka server: conditional JSON parsing, zod validation of
 * body/query/params, the route's middleware chain, then response serialization.
 *
 * @param server - The Polka webserver to register this route onto
 * @param route - The route definition, as returned by `defineRoute`
 */
export function mountRoute<
	TMethod extends HttpMethod,
	TPath extends string,
	TBody,
	TQuery,
	TParams,
	TResponse,
	TMiddlewares extends readonly TypedMiddleware<object>[],
>(server: Polka<any>, route: RouteDefinition<TMethod, TPath, TBody, TQuery, TParams, TResponse, TMiddlewares>): void {
	const middlewares: Middleware[] = [
		async (req, res, next) => {
			const isMetricsRequest = req.path === '/metrics' && req.method === 'GET';

			const timeout = setTimeout(() => {
				req.logger.warn({ method: req.method, path: req.path }, 'request is probably hanging');
			}, 30_000);

			const now = performance.now();
			res.on('close', () => {
				const durationMs = performance.now() - now;
				httpRequestDuration.observe(
					{ method: route.method.toUpperCase(), route: route.path, status_code: String(res.statusCode) },
					durationMs / 1_000,
				);

				const isMetricsSuccess = isMetricsRequest && res.statusCode >= 200 && res.statusCode < 300;
				if (!isMetricsSuccess) {
					req.logger.info(
						{ method: req.method, path: req.path, status: res.statusCode, duration: durationMs },
						'request complete',
					);
				}

				clearTimeout(timeout);
			});

			if (!isMetricsRequest) {
				req.logger.info({ method: req.method, path: req.path }, 'incoming request');
			}

			return next();
		},
	];

	// JSON body parser — only for routes that declare a body schema
	if (route.schema?.body) {
		middlewares.push(jsonParser());
	}

	// Zod validation
	if (route.schema) {
		middlewares.push(async (req, _res, next) => {
			try {
				if (route.schema?.body) {
					req.body = route.schema.body.parse(req.body);
				}

				if (route.schema?.query) {
					// query is typed as Record<string, string> on the base Request; the parsed shape can
					// legitimately differ (coercion, defaults), so this has to bypass that narrower type
					Reflect.set(req, 'query', route.schema.query.parse(req.query));
				}

				if (route.schema?.params) {
					// params is Record<string, string> in polka; cast is safe after zod coercion
					req.params = route.schema.params.parse(req.params) as Record<string, string>;
				}

				// eslint-disable-next-line n/callback-return -- next()'s return is void; no value to return here
				await next();
			} catch (error) {
				if (error instanceof ZodError) {
					// Passing the ZodError itself (not error.issues) as `.data` so `sendBoom`'s existing
					// treeifyError special-casing keeps serializing validation errors the same way it
					// already does for the old `validate` middleware.
					return next(badRequest('validation failed', error));
				}

				return next(error as Error);
			}
		});
	}

	// User-defined middleware
	if (route.middleware) {
		middlewares.push(...route.middleware.map((m) => m.handle.bind(m)));
	}

	// Final handler
	middlewares.push(async (reqUncast, res, next) => {
		// Cast is safe: body/query/params have been validated and coerced by Zod above, middleware has run
		const req = reqUncast as unknown as MiddlewareContext<TMiddlewares> & TypedRequest<TBody, TQuery, TParams>;
		const isMetricsRequest = req.path === '/metrics' && req.method === 'GET';

		try {
			if (!isMetricsRequest) {
				req.logger.info({ method: req.method, path: req.path }, 'passing to route handler from middleware');
			}

			const result = await route.handler(req, res);

			if (!isMetricsRequest) {
				req.logger.info({ method: req.method, path: req.path }, 'route handler complete');
			}

			if (!res.writableEnded) {
				if (result !== undefined && result !== null) {
					res.statusCode = 200;
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(result));
				} else {
					res.statusCode = 204;
					res.end();
				}
			}

			// Checked against the final status (after response handling above, in case a handler set a
			// non-2xx status and ended the response itself, e.g. `logout.ts`) -- a route resolving without
			// throwing doesn't guarantee a successful response, and clients shouldn't be told to refetch
			// off the back of a 4xx/5xx.
			if (route.realtimeChannel && res.statusCode >= 200 && res.statusCode < 300) {
				const channel = route.realtimeChannel(req);
				if (channel) {
					// Publishes over Redis rather than reaching into a local `WsHub` -- `services/ama-bot`'s
					// interaction handlers publish the exact same way, so this process doesn't need to be the
					// one a given browser socket is actually connected to for the signal to reach it.
					//
					// The header (not the authenticated user's id) is what tags the signal with an origin -- see
					// `RealtimeInvalidateMessage.originClientId`'s doc comment for why those two are different
					// things and the user id can't be substituted here.
					const originClientIdHeader = req.headers[RealtimeClientIdHeader.toLowerCase()];
					const originClientId = Array.isArray(originClientIdHeader) ? originClientIdHeader[0] : originClientIdHeader;
					await publishRealtimeInvalidate(channel, originClientId);
				}
			}
		} catch (error) {
			return next(error as Error);
		}
	});

	server[route.method](route.path, ...middlewares);
}
