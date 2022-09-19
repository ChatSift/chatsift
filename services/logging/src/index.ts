import 'reflect-metadata';
import { initConfig, kLogger } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import { container } from 'tsyringe';
import { Handler } from './handler';

void (async () => {
	const config = initConfig();

	const logger = createLogger('logging');

	const rest = new REST({
		api: `${config.discordProxyUrl}/api`,
	}).setToken(config.discordToken);

	rest.on('response', (req) => {
		if (req.method === 'POST' && req.path.includes('/webhooks/1021135799149936753')) {
			console.log(req);
		}
	});

	container.register(REST, { useValue: rest });
	container.register(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	await container.resolve(Handler).init();
	logger.info('Ready to handle logs');
})();
