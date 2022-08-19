import 'reflect-metadata';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { Env } from '@automoderator/common';
import {
	populateAbortErrorResponse,
	populateGeneralErrorResponse,
	populateRatelimitErrorResponse,
} from '@discordjs/proxy';
import {
	DiscordAPIError,
	HTTPError,
	parseResponse,
	RateLimitError,
	RequestMethod,
	REST,
	RouteLike,
} from '@discordjs/rest';
import { container } from 'tsyringe';
import { cache, fetchCache } from './cache';

const env = container.resolve(Env);

const rest = new REST({ rejectOnRateLimit: () => true, retries: 0 }).setToken(env.discordToken);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
const server = createServer(async (req, res) => {
	const { method, url } = req as { method: RequestMethod; url: string };
	const fullRoute = new URL(url, 'http://noop').pathname.replace(/^\/api(\/v\d+)?/, '') as RouteLike;

	if (method === RequestMethod.Get) {
		const cached = await fetchCache(fullRoute);
		if (cached) {
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

server.listen(3000);
