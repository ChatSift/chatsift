import 'reflect-metadata';
import { initConfig, kLogger, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createAmqp, PubSubPublisher } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import type { Logger } from 'pino';
import { container } from 'tsyringe';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { Handler } from './handler';

void (async () => {
	const config = initConfig();
	setGlobalDispatcher(new ProxyAgent(config.discordProxyUrl));

	const logger = createLogger('scheduler');

	const rest = new REST().setToken(config.discordToken);

	const { channel } = await createAmqp(config.amqpUrl);
	const logs = new PubSubPublisher(channel);

	await logs.init({ name: 'guild_logs', fanout: false });

	const redis = new Redis(config.redisUrl);

	container.register(kRedis, { useValue: redis });
	container.register(PubSubPublisher, { useValue: logs });
	container.register(REST, { useValue: rest });
	container.register<Logger>(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	container.resolve(Handler).init();
	logger.info('Ready to process scheduled tasks');
})();
