import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { URL } from 'node:url';
import { INJECTION_TOKENS } from '@automoderator/core';
import { populateErrorResponse } from '@discordjs/proxy';
import { REST, RequestMethod, type RouteLike } from '@discordjs/rest';
import { inject, injectable } from 'inversify';
import { type Logger } from 'pino';
import { ProxyCache } from './cache.js';
import { ReadableStreamClone } from './clone.js';

@injectable()
export class ProxyServer {
	readonly #rest = new REST({ rejectOnRateLimit: () => true, retries: 0 });

	readonly #httpServer: Server;

	public constructor(
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
		private readonly cache: ProxyCache,
	) {
		this.#httpServer = createServer(async (req, res) => this.handleRequest(req, res));
	}

	public listen(port: number) {
		this.#httpServer.listen(port);
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse) {
		const { method, url } = req as { method: RequestMethod; url: string };

		const parsedUrl = new URL(url, 'http://noop');
		// eslint-disable-next-line prefer-named-capture-group
		const fullRoute = parsedUrl.pathname.replace(/^\/api(\/v\d+)?/, '') as RouteLike;

		if (method === RequestMethod.Get) {
			const cached = await this.cache.fetch(fullRoute);
			if (cached !== null) {
				this.logger.debug(cached, 'cache hit');
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

		if (req.headers['x-audit-log-reason']) {
			headers['x-audit-log-reason'] = req.headers['x-audit-log-reason'] as string;
		}

		try {
			const discordResponse = await this.#rest.queueRequest({
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

			if (discordResponse.body) {
				const readable =
					discordResponse.body instanceof Readable ? discordResponse.body : Readable.fromWeb(discordResponse.body);
				const clone = new ReadableStreamClone(readable);
				const otherClone = new ReadableStreamClone(clone);

				await pipeline(clone, res);

				if (discordResponse.headers.get('content-type')?.startsWith('application/json')) {
					let jsonStr = '';
					otherClone.setEncoding('utf8');

					for await (const chunk of otherClone) {
						jsonStr += chunk.toString();
					}

					const data = JSON.parse(jsonStr);
					await this.cache.update(fullRoute, data);
				}
			}
		} catch (error) {
			this.logger.error({ err: error, fullRoute, method }, 'Something went wrong');
			const knownError = populateErrorResponse(res, error);
			if (!knownError) {
				throw error;
			}
		} finally {
			res.end();
		}
	}
}
