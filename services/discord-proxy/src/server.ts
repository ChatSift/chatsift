import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { Env, INJECTION_TOKENS } from '@automoderator/core';
import { populateErrorResponse } from '@discordjs/proxy';
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
	private readonly server: Server;

	public constructor(
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		private readonly cache: ProxyCache,
		private readonly env: Env,
	) {
		const rest = new REST({ rejectOnRateLimit: () => true, retries: 0 }).setToken(this.env.discordToken);
		this.server = createServer(async (req, res) => {
			const { method, url } = req as { method: RequestMethod; url: string };

			const parsedUrl = new URL(url, 'http://noop');
			// eslint-disable-next-line prefer-named-capture-group
			const fullRoute = parsedUrl.pathname.replace(/^\/api(\/v\d+)?/, '') as RouteLike;

			if (method === RequestMethod.Get) {
				const cached = await this.cache.fetch(fullRoute);
				this.logger.debug(cached, 'cache hit');
				if (cached !== null) {
					res.statusCode = 200;
					res.setHeader('Content-Type', 'application/json');
					return res.end(JSON.stringify(cached));
				}
			}

			const headers: Record<string, string> = {
				'Content-Type': req.headers['content-type']!,
			};

			if (req.headers.authorization) {
				headers.authorization = req.headers.authorization;
			}

			try {
				const discordResponse = await rest.queueRequest({
					body: req,
					fullRoute,
					method,
					auth: false,
					passThroughBody: true,
					query: parsedUrl.searchParams,
					headers,
				});

				res.statusCode = discordResponse.status;

				for (const [header, value] of discordResponse.headers) {
					// Strip ratelimit headers
					if (/^x-ratelimit/i.test(header)) {
						continue;
					}

					res.setHeader(header, value);
				}

				const data = await parseResponse(discordResponse);
				this.logger.debug(data, 'response');
				res.write(JSON.stringify(data));

				await this.cache.update(fullRoute, data);
			} catch (error) {
				this.logger.error({ err: error, fullRoute, method }, 'Something went wrong');
				const knownError = populateErrorResponse(res, error);
				if (!knownError) {
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
