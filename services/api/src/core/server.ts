import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { publishRealtimeInvalidate } from '@chatsift/backend-core';
import { RealtimeClientIdHeader } from '@chatsift/core';
import { badRequest } from '@hapi/boom';
import type { Middleware, Polka } from 'polka';
import { ZodError } from 'zod';
import { jsonParser } from '../middleware/jsonParser.js';
import { IS_AUTHED_MARKER, IS_GUILD_MANAGER_MARKER } from './isAuthedMarker.js';
import { httpRequestDuration } from './metrics.js';
import type { HttpMethod, MiddlewareContext, RouteDefinition, TypedMiddleware, TypedRequest } from './route.js';

/**
 * Every `isAuthed`-guarded route not scoped to a single guild via a `:guildId` param. A guild-scoped
 * `/dashboard` session (see `middleware/isAuthed.ts`) defaults to *allowed* on every `isAuthed` route so that,
 * unlike the one-time grant tokens it replaced, adding a new guild-scoped route never needs an auth opt-in --
 * the trade-off is that a route reachable *outside* a single guild needs an explicit decision instead of
 * silence, which is what `assertGuildScopedRouteGuard` below enforces at boot. Add a route here only after
 * confirming it's safe for a time-boxed, guild-scoped credential to reach.
 */
const NON_GUILD_SCOPED_ROUTES = new Set<string>([
	'/v3/auth/discord',
	'/v3/auth/discord/callback',
	'/v3/auth/logout',
	'/v3/auth/me',
	'/v3/ws/ticket',
	// Experiment gating (docs/roadmap/11-automoderator-port.md). Deliberately global rather than guild-scoped:
	// an experiment's range applies across every guild, so there is no `:guildId` to scope it to. Safe for a
	// `/dashboard` session to *reach* because all three additionally require `isGlobalAdmin: true`, which such a
	// session can satisfy only if that same user is already a global admin -- the scoped credential grants no
	// authority here that its holder doesn't have anyway.
	'/v3/experiments',
	'/v3/experiments/:name',
]);

/**
 * `:guildId`-scoped routes that deliberately don't set `isGuildManager: true`/`'or-ama-guest'` and so get none
 * of `isAuthed`'s automatic enforcement, because they call `isGuildManagerToken` themselves and derive their
 * result set from it rather than rejecting outright -- see `routes/ama/getAMAs.ts`'s own comment on why (guests
 * need to reach it too, just filtered to a narrower result). A path in this set is asserting "I checked
 * `req.params.guildId` against the token by hand", not "no check is needed" -- add to it only alongside that
 * same manual call.
 */
const MANUALLY_GUILD_VERIFIED_ROUTES = new Set<string>(['/v3/guilds/:guildId/ama/amas']);

function assertGuildScopedRouteGuard(
	route: Pick<RouteDefinition<any, any, any, any, any, any>, 'method' | 'path'>,
	usesIsAuthed: boolean,
	usesGuildManagerCheck: boolean,
): void {
	if (!usesIsAuthed) {
		return;
	}

	if (!route.path.includes(':guildId')) {
		if (NON_GUILD_SCOPED_ROUTES.has(route.path)) {
			return;
		}

		throw new Error(
			`Route ${route.method.toUpperCase()} ${route.path} is authed via isAuthed() but has no :guildId param and ` +
				`is not in NON_GUILD_SCOPED_ROUTES (core/server.ts) -- a /dashboard scoped session defaults to allowed ` +
				`on every isAuthed route, so a route reachable outside a single guild needs an explicit decision here, ` +
				`not silence.`,
		);
	}

	if (usesGuildManagerCheck || MANUALLY_GUILD_VERIFIED_ROUTES.has(route.path)) {
		return;
	}

	throw new Error(
		`Route ${route.method.toUpperCase()} ${route.path} has a :guildId param but doesn't set isGuildManager: ` +
			`true/'or-ama-guest' and isn't in MANUALLY_GUILD_VERIFIED_ROUTES (core/server.ts) -- having :guildId in ` +
			`the path proves nothing on its own about whether the caller's guild access was actually checked ` +
			`against it, which is what a /dashboard scoped session's whole authorization boundary rests on.`,
	);
}

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
	assertGuildScopedRouteGuard(
		route,
		route.middleware?.some((mw) => Reflect.get(mw, IS_AUTHED_MARKER) === true) ?? false,
		route.middleware?.some((mw) => Reflect.get(mw, IS_GUILD_MANAGER_MARKER) === true) ?? false,
	);

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
				const channels = route.realtimeChannel(req);
				if (channels?.length) {
					// The header (not the authenticated user's id) is what tags the signal with an origin -- see
					// `RealtimeInvalidateMessage.originClientId`'s doc comment for why those two are different
					// things and the user id can't be substituted here.
					const originClientIdHeader = req.headers[RealtimeClientIdHeader.toLowerCase()];
					const originClientId = Array.isArray(originClientIdHeader) ? originClientIdHeader[0] : originClientIdHeader;

					// Publishes over Redis rather than reaching into a local `WsHub` -- `services/ama-bot`'s
					// interaction handlers publish the exact same way, so this process doesn't need to be the
					// one a given browser socket is actually connected to for the signal to reach it. Multiple
					// channels are handed over as a batch so they cost one round trip, not one each.
					await publishRealtimeInvalidate(channels, originClientId);
				}
			}
		} catch (error) {
			return next(error as Error);
		}
	});

	server[route.method](route.path, ...middlewares);
}
