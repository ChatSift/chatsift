import 'reflect-metadata';
import { initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { CordisResponse, HTTPError, Rest as DiscordRest } from '@cordis/rest';
import polka from 'polka';
import { sendBoom } from '@chatsift/rest-utils';
import { createServer } from 'http';
import { isBoom, Boom, badRequest } from '@hapi/boom';
import { Headers } from 'node-fetch';
import { resolveCacheOptions } from './cache';
import type { Response } from 'node-fetch';

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

void (() => {
	const config = initConfig();
	const logger = createLogger('discord-proxy');
	const rest = new DiscordRest(config.discordToken);

	rest
		.on('response', async (req, res, rl) => {
			logger.trace({ rl }, `Finished request ${req.method!} ${req.path!}`);

			if (!res.ok) {
				logger.warn(
					{
						res: await res.json(),
						rl,
					},
					`Failed request ${req.method!} ${req.path!}`,
				);
			}
		})
		.on('ratelimit', (bucket, endpoint, prevented, waitingFor) => {
			logger.warn(
				{
					bucket,
					prevented,
					waitingFor,
				},
				`Hit a ratelimit on ${endpoint}`,
			);
		})
		.on('abort', (req) => {
			logger.warn({ req }, `Aborted request ${req.method!} ${req.path!}`);
		});

	const app = polka({
		onError(e, _, res) {
			res.setHeader('content-type', 'application/json');
			const boom = isBoom(e) ? e : new Boom(e);

			if (boom.output.statusCode === 500) {
				logger.error({ error: boom }, boom.message);
			}

			return sendBoom(boom, res);
		},
		server: createServer(),
	});

	app.use(async (req, res, next) => {
		if (!(VALID_METHODS as Readonly<string[]>).includes(req.method)) {
			return next(badRequest(`Invalid method ${req.method}`));
		}

		const method = req.method.toLowerCase() as Lowercase<typeof VALID_METHODS[number]>;

		const cacheOptions = resolveCacheOptions(req.path, method);

		let data: CordisResponse | Response;
		try {
			data = await rest.make({
				path: req.path,
				method,
				data: method === 'get' ? undefined : req,
				headers: new Headers({ 'Content-Type': req.headers['content-type']! }),
				query: req.query,
				...cacheOptions,
			});
		} catch (e) {
			if (e instanceof HTTPError) {
				data = e.response;
			} else {
				throw e;
			}
		}

		logger.metric!({
			type: 'discord_proxy_cache',
			method,
			path: req.path.replaceAll(/\d{17,19}/g, ':id'),
			cached: 'cached' in data ? data.cached : false,
		});

		res.setHeader('content-type', data.headers.get('content-type') ?? 'application/json');
		res.statusCode = data.status;

		const body = data.headers.get('content-type')?.startsWith('application/json') ? await data.json() : {};
		return res.end(JSON.stringify(body));
	});

	app.listen(3003, () => logger.info('Listening for requests on port 3003'));
})();
