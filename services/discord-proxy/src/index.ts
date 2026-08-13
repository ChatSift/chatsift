import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { RequestMethod } from '@discordjs/rest';
import type { Logger } from 'pino';
import { forwardableRequestHeaders, hasRequestBody, parseFullRoute } from './lib/http.js';
import { populateErrorResponse, populateSuccessResponse } from './lib/responses.js';
import { createRestCache } from './lib/rests.js';

/**
 * Answered locally, never forwarded. Discord's own routes all sit under `/api`, so there's no collision.
 */
const HEALTH_ROUTE = '/health';

/**
 * A single HTTP hop in front of Discord's REST API, so that rate limit accounting for a given bot token
 * happens in exactly one place.
 *
 * The problem it solves: every bot's token is used from two processes -- its own `services/*-bot` and
 * `services/api` (the dashboard's backend) -- and `@discordjs/rest` keeps bucket state in memory, per
 * instance. Two independent accountants for one token means each one only ever sees a fraction of the
 * requests that token actually made, so both under-count and Discord is the one that notices.
 *
 * Deliberately not a cache. The old stack's proxy cached GETs by route, but the app layer above this one now
 * does that far better (`services/api`'s `guildDataCache.ts`, `services/social-bot`'s `discordCache.ts`):
 * redis-backed rather than process-local, with invalidation, negative caching, and -- critically -- keyed per
 * `(botId, guildId, instance)`. A URL-keyed cache down here would serve one bot's view of a guild to another.
 */
export function createProxyServer(logger: Logger): Server {
	const rests = createRestCache(logger);

	async function respond(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const { method, url } = req;

		if (!method || !url) {
			res.statusCode = 400;
			return;
		}

		const parsedUrl = new URL(url, 'http://noop');

		if (parsedUrl.pathname === HEALTH_ROUTE) {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'application/json');
			res.write(JSON.stringify({ status: 'ok', tokens: rests.size }));
			return;
		}

		const fullRoute = parseFullRoute(parsedUrl.pathname);
		const { authorization } = req.headers;

		try {
			const discordResponse = await rests.forAuthorization(authorization).queueRequest({
				fullRoute,
				// Cast rather than validated: an unsupported verb should come back as Discord's own 405, not as
				// something we invent here.
				method: method as RequestMethod,
				// We forward the caller's `Authorization` header ourselves (see `forwardableRequestHeaders`), so
				// `REST` must not try to add one of its own -- these instances are never given a token.
				auth: false,
				body: hasRequestBody(req) ? req : undefined,
				passThroughBody: true,
				query: parsedUrl.searchParams,
				headers: forwardableRequestHeaders(req),
			});

			await populateSuccessResponse(res, discordResponse);
		} catch (error) {
			if (!populateErrorResponse(res, error)) {
				logger.error({ err: error, fullRoute, method }, 'Failed to proxy a request to Discord');
				res.statusCode = 500;
			}
		}
	}

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			await respond(req, res);
		} finally {
			// Piping a success body already ended the response, so this only closes out the paths that set a
			// status and wrote nothing.
			if (!res.writableEnded) {
				res.end();
			}
		}
	}

	return createServer((req, res) => void handle(req, res));
}
