import 'reflect-metadata';
import { Rest } from '@chatsift/api-wrapper';
import { initConfig, kLogger, kRedis, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import postgres, { Sql } from 'postgres';
import { container } from 'tsyringe';
import { Gateway } from './gateway';
import Redis, { Redis as IORedis } from 'ioredis';

void (async () => {
	const config = initConfig();
	container.register(Rest, { useValue: new Rest(config.apiDomain, config.internalApiToken) });

	const logger = createLogger('mod-observer');

	const discordRest = new DiscordRest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
		abortAfter: 20e3,
	}).on('abort', (req) => {
		logger.warn({ req }, `Aborted request ${req.method!} ${req.path!}`);
	});

	const sql = postgres(config.dbUrl, {
		onnotice: (notice) => logger.debug({ notice }, 'Database notice'),
	});

	container.register(DiscordRest, { useValue: discordRest });
	container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register<Sql<{}>>(kSql, { useValue: sql });
	container.register<Logger>(kLogger, { useValue: logger });

	await container.resolve(Gateway).init();
	logger.info('Ready to listen to manual mod actions');
})();
