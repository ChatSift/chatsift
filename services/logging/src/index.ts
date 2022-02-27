import 'reflect-metadata';
import { initConfig, kLogger } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest } from '@cordis/rest';
import { container } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { Handler } from './handler';

void (async () => {
	const config = initConfig();
	const logger = createLogger('logging');

	const rest = new Rest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
		abortAfter: 20e3,
	}).on('abort', (req) => {
		logger.warn({ req }, `Aborted request ${req.method!} ${req.path!}`);
	});

	container.register(Rest, { useValue: rest });
	container.register(kLogger, { useValue: logger });
	container.register(PrismaClient, { useValue: new PrismaClient() });

	await container.resolve(Handler).init();
	logger.info('Ready to handle logs');
})();
