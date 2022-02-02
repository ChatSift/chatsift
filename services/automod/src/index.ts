import 'reflect-metadata';
import { Rest } from '@chatsift/api-wrapper';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import { container } from 'tsyringe';
import { Gateway } from './gateway';
import Redis, { Redis as IORedis } from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';

void (async () => {
	const config = initConfig();
	const logger = createLogger('automod');

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

	container.register(RoutingSubscriber, { useValue: new RoutingSubscriber(channel) });
	container.register(PubSubPublisher, { useValue: logs });
	container.register(Rest, { useValue: new Rest(config.apiDomain, config.internalApiToken) });
	container.register(DiscordRest, { useValue: discordRest });
	container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register(PrismaClient, { useValue: new PrismaClient() });
	container.register<Logger>(kLogger, { useValue: logger });

	await container.resolve(Gateway).init();
	logger.info('Ready to listen to message packets');
})();
