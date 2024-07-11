import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { injectable } from 'inversify';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import createPinoLogger from 'pino';
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
import type { TransportOptions } from './loggingTransport.js';

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

	public registerLogger(stream: string): Logger {
		const options: TransportOptions = {
			domain: this.env.parseableDomain,
			auth: this.env.parseableAuth,
			stream: `${this.env.service}${stream}`,
		};

		const logger = createPinoLogger({
			level: 'trace',
			transport: {
				target: '../util/loggingTransport.js',
				options,
			},
		});
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
