import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { Env, INJECTION_TOKENS } from '@automoderator/core';
import {
	populateAbortErrorResponse,
	populateGeneralErrorResponse,
	populateRatelimitErrorResponse,
} from '@discordjs/proxy';
import {
	REST,
	RequestMethod,
	parseResponse,
	type RouteLike,
	DiscordAPIError,
	HTTPError,
	RateLimitError,
} from '@discordjs/rest';
import { inject, injectable } from 'inversify';
import { type Logger } from 'pino';
import { ProxyCache } from './cache.js';

@injectable()
export class ProxyServer {
	@inject(INJECTION_TOKENS.logger)
	private readonly logger!: Logger;

	@inject(ProxyCache)
	private readonly cache!: ProxyCache;

	@inject(Env)
	private readonly env!: Env;

	private readonly rest: REST;

	private readonly server: Server;

	public constructor() {
		this.rest = new REST({ rejectOnRateLimit: () => true, retries: 0 }).setToken(this.env.discordToken);
		this.server = createServer(async (req, res) => {
			const { method, url } = req as { method: RequestMethod; url: string };
			// eslint-disable-next-line prefer-named-capture-group
			const fullRoute = new URL(url, 'http://noop').pathname.replace(/^\/api(\/v\d+)?/, '') as RouteLike;

			if (method === RequestMethod.Get) {
				const cached = await this.cache.fetch(fullRoute);
				if (cached !== null) {
					res.statusCode = 200;
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify(cached));
				}
			}

			try {
				const discordResponse = await this.rest.queueRequest({
					body: req,
					fullRoute,
					method,
					passThroughBody: true,
				});

				res.statusCode = discordResponse.status;

				for (const header of Object.keys(discordResponse.headers)) {
					// Strip ratelimit headers
					if (header.startsWith('x-ratelimit')) {
						continue;
					}

					res.setHeader(header, discordResponse.headers.get(header)!);
				}

				const data = await parseResponse(discordResponse);
				res.write(JSON.stringify(data));

				await this.cache.update(fullRoute, data);
			} catch (error) {
				this.logger.error({ err: error, fullRoute, method }, 'Something went wrong');
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
	}

	public listen() {
		this.server.listen(8_000);
	}
}
