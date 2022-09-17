import 'reflect-metadata';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import {
	populateGeneralErrorResponse,
	populateRatelimitErrorResponse,
	populateAbortErrorResponse,
} from '@discordjs/proxy';
import type { RouteLike } from '@discordjs/rest';
import { DiscordAPIError, HTTPError, parseResponse, RateLimitError, RequestMethod, REST } from '@discordjs/rest';
import { cache, fetchCache } from './cache';

const config = initConfig();
const rest = new REST({ rejectOnRateLimit: () => true, retries: 0 }).setToken(config.discordToken);
const logger = createLogger('discord-proxy');

// eslint-disable-next-line @typescript-eslint/no-misused-promises
const server = createServer(async (req, res) => {
	const { method, url } = req as { method: RequestMethod; url: string };
	const fullRoute = new URL(url, 'http://noop').pathname.replace(/^\/api(\/v\d+)?/, '') as RouteLike;

	if (method === RequestMethod.Get) {
		const cached = fetchCache(fullRoute);
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
			headers: {
				'Content-Type': req.headers['content-type']!,
			},
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

		cache(fullRoute, data);
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

server.listen(3_003, () => logger.info('Listening for requests on port 3003'));
