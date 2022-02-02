import 'reflect-metadata';
import { initConfig, kLogger } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { sendBoom, attachHttpUtils, Route } from '@chatsift/rest-utils';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import { readdirRecurse } from '@chatsift/readdir';
import { join as joinPath } from 'path';
import { container, InjectionToken } from 'tsyringe';
import polka, { Middleware } from 'polka';
import { Boom, isBoom, notFound } from '@hapi/boom';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { logRequests } from './middleware';
import { PrismaClient } from '@prisma/client';

void (async () => {
	const config = initConfig();
	const logger = createLogger('api');

	const discordRest = new DiscordRest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
		abortAfter: 20e3,
	}).on('abort', (req) => {
		logger.warn({ req }, `Aborted request ${req.method!} ${req.path!}`);
	});

	container.register(PrismaClient, { useValue: new PrismaClient() });
	container.register(kLogger, { useValue: logger });
	container.register(DiscordRest, { useValue: discordRest });

	const app = polka({
		onError(e, _, res) {
			res.setHeader('content-type', 'application/json');
			const boom = isBoom(e) ? e : new Boom(e);

			if (boom.output.statusCode === 500) {
				logger.error({ error: boom }, boom.message);
			}

			return sendBoom(boom, res);
		},
		onNoMatch(_, res) {
			res.setHeader('content-type', 'application/json');
			return sendBoom(notFound(), res);
		},
		server: createServer(),
	}).use(
		cors({
			origin: config.cors,
			credentials: true,
		}),
		helmet({ contentSecurityPolicy: config.nodeEnv === 'prod' ? undefined : false }) as Middleware,
		attachHttpUtils(),
		logRequests(),
	);

	const files = readdirRecurse(joinPath(__dirname, 'routes'), { fileExtensions: ['js'] });

	for await (const file of files) {
		const info = Route.pathToRouteInfo(file.split('/routes').pop()!);
		if (!info) {
			logger.debug(`Hit path with no info: "${file}"`);
			continue;
		}

		const route = container.resolve<Route>(((await import(file)) as { default: InjectionToken<Route> }).default);
		route.register(info, app);
	}

	app.listen(3001, () => logger.info('Listening to requests on port 3001'));
})();
