import 'reflect-metadata';
import { Rest } from '@chatsift/api-wrapper/v2';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import { container } from 'tsyringe';
import { Gateway } from './gateway';
import { PrismaClient } from '@prisma/client';
import Redis, { Redis as IORedis } from 'ioredis';
import { createAmqp, PubSubPublisher } from '@cordis/brokers';

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

	const { channel } = await createAmqp(config.amqpUrl);
	const logs = new PubSubPublisher(channel);

	await logs.init({ name: 'guild_logs', fanout: false });

	container.register(PubSubPublisher, { useValue: logs });
	container.register(DiscordRest, { useValue: discordRest });
	container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register<Logger>(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	await container.resolve(Gateway).init();
	logger.info('Ready to listen to manual mod actions');
})();
