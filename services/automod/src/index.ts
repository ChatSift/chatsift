import 'reflect-metadata';
import { Rest } from '@chatsift/api-wrapper';
import { initConfig, kLogger, kRedis, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import postgres, { Sql } from 'postgres';
import { container } from 'tsyringe';
import { Gateway } from './gateway';
import * as runners from './runners';
import Redis, { Redis as IORedis } from 'ioredis';

void (async () => {
	const config = initConfig();
	container.register(Rest, { useValue: new Rest(config.apiDomain, config.internalApiToken) });

	const discordRest = new DiscordRest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
	});

	const logger = createLogger('automod');

	const sql = postgres(config.dbUrl, {
		onnotice: (notice) => logger.debug({ notice }, 'Database notice'),
	});

	container.register(DiscordRest, { useValue: discordRest });
	container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register<Sql<{}>>(kSql, { useValue: sql });
	container.register<Logger>(kLogger, { useValue: logger });
	for (const runner of Object.values(runners)) {
		// @ts-expect-error - tsyringe typings are screwed
		container.register(runner, { useClass: runner });
	}

	await container.resolve(Gateway).init();
	logger.info('Ready to listen to message packets');
})();
