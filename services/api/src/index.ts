import 'reflect-metadata';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { sendBoom, attachHttpUtils, Route } from '@chatsift/rest-utils';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import { readdirRecurse } from '@chatsift/readdir';
import { join as joinPath } from 'path';
import postgres from 'postgres';
import { container, InjectionToken } from 'tsyringe';
import * as controllers from './controllers';
import polka, { Middleware } from 'polka';
import { Boom, isBoom, notFound } from '@hapi/boom';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { logRequests } from './middleware';
import { TokenManager } from './util';

void (async () => {
	const config = initConfig();
	const logger = createLogger('api');

	container.register(kLogger, { useValue: logger });
	container.register(kSql, {
		useValue: postgres(config.dbUrl, {
			onnotice: (notice) => logger.debug({ notice }, 'Database notice'),
		}),
	});

	const discordRest = new DiscordRest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
	});

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

	for (const controller of Object.values(controllers) as typeof controllers.FilterIgnoresController[]) {
		container.register(controller, { useClass: controller });
	}

	container.register(TokenManager, { useClass: TokenManager });

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
