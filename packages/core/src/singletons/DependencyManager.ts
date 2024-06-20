import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { injectable } from 'inversify';
import { Redis } from 'ioredis';
import { Kysely, PostgresDialect } from 'kysely';
import type { Logger } from 'pino';
import createPinoLogger from 'pino';
import { GuildCacheEntity, type CachedGuild } from '../cache/entities/GuildCacheEntity.js';
import type { ICacheEntity } from '../cache/entities/ICacheEntity.js';
import { INJECTION_TOKENS, globalContainer } from '../container.js';
import type { DB } from '../db.js';
import type { TransportOptions } from '../util/loggingTransport.js';
import { Env } from './Env.js';

// no proper ESM support
const {
	default: { Pool },
} = await import('pg');

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

	public registerDatabase(): Kysely<DB> {
		const database = new Kysely<DB>({
			dialect: new PostgresDialect({
				pool: new Pool({
					host: this.env.postgresHost,
					port: this.env.postgresPort,
					user: this.env.postgresUser,
					password: this.env.postgresPassword,
					database: this.env.postgresDatabase,
				}),
			}),
		});

		globalContainer.bind<Kysely<DB>>(Kysely).toConstantValue(database);
		return database;
	}

	public registerLogger(stream: string): Logger {
		const options: TransportOptions = {
			domain: this.env.parseableDomain,
			auth: this.env.parseableAuth,
			stream,
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
	}
}
