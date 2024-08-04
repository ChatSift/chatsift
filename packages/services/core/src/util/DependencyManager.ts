import type { PinoRotateFileOptions } from '@chatsift/pino-rotate-file';
import { API } from '@discordjs/core';
import { DefaultRestOptions, REST } from '@discordjs/rest';
import { injectable } from 'inversify';
import { Redis } from 'ioredis';
import type { Logger, TransportTargetOptions } from 'pino';
import createPinoLogger, { pino } from 'pino';
import { credentialsForCurrentBot, Env } from '../Env.js';
import { INJECTION_TOKENS, globalContainer } from '../container.js';

@injectable()
/**
 * Helper class to abstract away boilerplate present at the start of every service.
 *
 * @remarks
 * There are services that run I/O from the get-go (e.g. the database), that need to be explicitly
 * opted-into by each service, which is what the methods in this class are for.
 *
 * Additionally, this class is responsible for binding certain structures, that cannot be directly resolved
 * (e.g. factories, things abstracted away by interfaces)
 */
export class DependencyManager {
	public registerRedis(): Redis {
		const redis = new Redis(Env.REDIS_URL);
		globalContainer.bind<Redis>(INJECTION_TOKENS.redis).toConstantValue(redis);
		return redis;
	}

	public registerApi(withToken = true): API {
		const credentials = withToken ? credentialsForCurrentBot() : null;

		const rest = new REST({ api: credentials ? `${credentials.proxyURL}/api` : DefaultRestOptions.api, version: '10' });

		if (credentials) {
			rest.setToken(credentials.token);
		}

		const api = new API(rest);

		globalContainer.bind<API>(API).toConstantValue(api);
		return api;
	}

	public registerLogger(service: string): Logger {
		const targets: TransportTargetOptions[] = [
			{
				target: 'pino/file',
				level: 'trace',
				options: {
					destination: 1, // stdout
				},
			},
		];

		if (Env.NODE_ENV === 'prod') {
			const options: PinoRotateFileOptions = {
				dir: Env.LOGS_DIR,
				mkdir: false,
				maxAgeDays: 14,
				prettyOptions: {
					translateTime: 'SYS:standard',
					levelKey: 'levelNum',
				},
			};

			targets.push({
				target: '@chatsift/pino-rotate-file',
				level: 'trace',
				options,
			});
		}

		const transport = pino.transport({
			targets,
			level: 'trace',
		});

		const logger = createPinoLogger(
			{
				level: 'trace',
				name: service,
				timestamp: pino.stdTimeFunctions.isoTime,
				formatters: {
					level: (levelLabel, level) => ({ level, levelLabel }),
				},
			},
			transport,
		);

		globalContainer.bind<Logger>(INJECTION_TOKENS.logger).toConstantValue(logger);
		return logger;
	}
}
