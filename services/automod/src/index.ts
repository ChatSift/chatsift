import 'reflect-metadata';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createAmqp, PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import type { Redis as IORedis } from 'ioredis';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import { container } from 'tsyringe';
import { Gateway } from './gateway';

void (async () => {
	const config = initConfig();

	const logger = createLogger('automod');

	const rest = new REST({
		api: `${config.discordProxyUrl}/api`,
	}).setToken(config.discordToken);

	const { channel } = await createAmqp(config.amqpUrl);
	const logs = new PubSubPublisher(channel);

	await logs.init({ name: 'guild_logs', fanout: false });

	container.register(RoutingSubscriber, { useValue: new RoutingSubscriber(channel) });
	container.register(PubSubPublisher, { useValue: logs });
	container.register(REST, { useValue: rest });
	container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
	container.register(PrismaClient, { useValue: new PrismaClient() });
	container.register<Logger>(kLogger, { useValue: logger });

	await container.resolve(Gateway).init();
	logger.info('Ready to listen to message packets');
})();
