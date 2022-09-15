import 'reflect-metadata';
import { initConfig, kLogger } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import { container } from 'tsyringe';
import { ProxyAgent } from 'undici';
import { Handler } from './handler';

void (async () => {
	const config = initConfig();

	const logger = createLogger('logging');

	const rest = new REST().setToken(config.discordToken).setAgent(new ProxyAgent(config.discordProxyUrl));

	container.register(REST, { useValue: rest });
	container.register(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	await container.resolve(Handler).init();
	logger.info('Ready to handle logs');
})();
