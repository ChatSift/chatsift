import type { PinoRotateFileOptions } from '@chatsift/pino-rotate-file';
import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { injectable } from 'inversify';
import { Redis } from 'ioredis';
import type { Logger, TransportTargetOptions } from 'pino';
import createPinoLogger, { pino } from 'pino';
import type { PrettyOptions } from 'pino-pretty';
import { GuildCacheEntity, type CachedGuild } from '../cache/entities/GuildCacheEntity.js';
import type { ICacheEntity } from '../cache/entities/ICacheEntity.js';
import { INJECTION_TOKENS, globalContainer } from '../container.js';
import { IDatabase } from '../database/IDatabase.js';
import { KyselyPostgresDatabase } from '../database/KyselyPostgresDatabase.js';
import { ExperimentHandler } from '../experiments/ExperimentHandler.js';
import { IExperimentHandler } from '../experiments/IExperimentHandler.js';
import { INotifier } from '../notifications/INotifier.js';
import { Notifier } from '../notifications/Notifier.js';
import { Env } from './Env.js';

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
	public constructor(private readonly env: Env) {
		this.registerStructures();
	}

	public registerRedis(): Redis {
		const redis = new Redis(this.env.redisUrl);
		globalContainer.bind<Redis>(INJECTION_TOKENS.redis).toConstantValue(redis);
		return redis;
	}

	public registerApi(): API {
		const rest = new REST({ api: `${this.env.discordProxyURL}/api`, version: '10' });
		rest.setToken(this.env.discordToken);

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

		if (this.env.nodeEnv === 'prod') {
			const options: PinoRotateFileOptions = {
				dir: this.env.logsDir,
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

	private registerStructures(): void {
		// cache entities
		globalContainer
			.bind<ICacheEntity<CachedGuild>>(INJECTION_TOKENS.cacheEntities.guild)
			.to(GuildCacheEntity)
			.inSingletonScope();

		// Those can always be swapped out for diff. impls
		globalContainer.bind<IDatabase>(IDatabase).to(KyselyPostgresDatabase);
		globalContainer.bind<IExperimentHandler>(IExperimentHandler).to(ExperimentHandler);
		globalContainer.bind<INotifier>(INotifier).to(Notifier);
	}
}
