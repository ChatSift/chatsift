import 'reflect-metadata';
import { Rest } from '@chatsift/api-wrapper';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import { container } from 'tsyringe';
import { Handler } from './handler';
import { PrismaClient } from '@prisma/client';
import { createAmqp, PubSubPublisher } from '@cordis/brokers';
import Redis from 'ioredis';

void (async () => {
	const config = initConfig();
	container.register(Rest, { useValue: new Rest(config.apiDomain, config.internalApiToken) });

	const logger = createLogger('scheduler');

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

	const redis = new Redis(config.redisUrl);

	container.register(kRedis, { useValue: redis });
	container.register(PubSubPublisher, { useValue: logs });
	container.register(DiscordRest, { useValue: discordRest });
	container.register<Logger>(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	container.resolve(Handler).init();
	logger.info('Ready to process scheduled tasks');
})();
