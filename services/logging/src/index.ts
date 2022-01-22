import 'reflect-metadata';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { ProxyBucket, Rest } from '@cordis/rest';
import postgres from 'postgres';
import { container } from 'tsyringe';
import { Handler } from './handler';

void (async () => {
	const config = initConfig();
	const logger = createLogger('logging');

	const rest = new Rest(config.discordToken, {
		bucket: ProxyBucket,
		domain: config.discordProxyUrl,
		retries: 1,
	});

	container.register(Rest, { useValue: rest });
	container.register(kLogger, { useValue: logger });
	container.register(kSql, {
		useValue: postgres(config.dbUrl, {
			onnotice: (notice) => logger.debug({ notice }, 'Database notice'),
		}),
	});

	await container.resolve(Handler).init();
	logger.info('Ready to handle logs');
})();
