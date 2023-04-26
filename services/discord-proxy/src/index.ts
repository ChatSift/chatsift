import 'reflect-metadata';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { createLogger, Env, SYMBOLS } from '@automoderator/core';
import {
	populateAbortErrorResponse,
	populateGeneralErrorResponse,
	populateRatelimitErrorResponse,
} from '@discordjs/proxy';
import type { RouteLike } from '@discordjs/rest';
import { DiscordAPIError, HTTPError, parseResponse, RateLimitError, RequestMethod, REST } from '@discordjs/rest';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import { cache, fetchCache } from './cache.js';

const logger = createLogger('discord-proxy');

const env = container.resolve(Env);
container.register(SYMBOLS.redis, { useValue: new Redis(env.redisUrl) });

const rest = new REST({ rejectOnRateLimit: () => true, retries: 0 }).setToken(env.discordToken);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const server = createServer(async (req, res) => {
	const { method, url } = req as { method: RequestMethod; url: string };
	// eslint-disable-next-line prefer-named-capture-group, unicorn/no-unsafe-regex
	const fullRoute = new URL(url, 'http://noop').pathname.replace(/^\/api(\/v\d+)?/, '') as RouteLike;

	if (method === RequestMethod.Get) {
		const cached = await fetchCache(fullRoute);
		if (cached) {
			logger.trace({ fullRoute }, 'Cache hit');
			res.statusCode = 200;
			res.setHeader('Content-Type', 'application/json');
			return res.end(JSON.stringify(cached));
		}
	}

	try {
		const discordResponse = await rest.raw({
			body: req,
			fullRoute,
			method,
			passThroughBody: true,
		});

		res.statusCode = discordResponse.statusCode;

		for (const header of Object.keys(discordResponse.headers)) {
			// Strip ratelimit headers
			if (header.startsWith('x-ratelimit')) {
				continue;
			}

			res.setHeader(header, discordResponse.headers[header]!);
		}

		const data = await parseResponse(discordResponse);
		res.write(JSON.stringify(data));

		await cache(fullRoute, data);
	} catch (error) {
		logger.error({ err: error, fullRoute, method }, 'Something went wrong');
		if (error instanceof DiscordAPIError || error instanceof HTTPError) {
			populateGeneralErrorResponse(res, error);
		} else if (error instanceof RateLimitError) {
			populateRatelimitErrorResponse(res, error);
		} else if (error instanceof Error && error.name === 'AbortError') {
			populateAbortErrorResponse(res);
		} else {
			throw error;
		}
	} finally {
		res.end();
	}
});

server.listen(8_080, () => logger.info('Listening on port 8080 for requests'));
