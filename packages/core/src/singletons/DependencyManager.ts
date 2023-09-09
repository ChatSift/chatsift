import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { Container, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { Kysely, PostgresDialect } from 'kysely';
import type { Logger } from 'pino';
import createPinoLogger from 'pino';
import { GuildCacheEntity, type CachedGuild } from '../cache/entities/GuildCacheEntity.js';
import type { ICacheEntity } from '../cache/entities/ICacheEntity.js';
import type { DB } from '../db.js';
import { Env } from './Env.js';

// no proper ESM support
const {
	default: { Pool },
} = await import('pg');

export const globalContainer = new Container({
	autoBindInjectable: true,
	defaultScope: 'Singleton',
});

export const INJECTION_TOKENS = {
	redis: Symbol('redis instance'),
	logger: Symbol('logger instance'),
	cacheEntities: {
		guild: Symbol('guild cache entity'),
	},
} as const;

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

	public registerLogger(): Logger {
		const logger = createPinoLogger({ level: 'trace' });
		globalContainer.bind<Logger>(INJECTION_TOKENS.logger).toConstantValue(logger);
		return logger;
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

	private registerStructures(): void {
		globalContainer
			.bind<ICacheEntity<CachedGuild>>(INJECTION_TOKENS.cacheEntities.guild)
			.to(GuildCacheEntity)
			.inSingletonScope();
	}
}
