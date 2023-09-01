import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { Container, injectable } from 'inversify';
import { Redis } from 'ioredis';
import { Kysely, PostgresDialect } from 'kysely';
import type { Logger } from 'pino';
import createPinoLogger from 'pino';
import type { DataReader, DataWriter } from '../binary-encoding/Data.js';
import { Reader } from '../binary-encoding/Reader.js';
import { Writer } from '../binary-encoding/Writer.js';
import type { DB } from '../db.js';
import { Env } from './Env.js';

// no proper ESM support
const {
	default: { Pool },
} = await import('pg');

export const globalContainer = new Container({
	autoBindInjectable: true,
	defaultScope: 'Singleton',
	skipBaseClassChecks: true,
});

export const INJECTION_TOKENS = {
	redis: Symbol('redis instance'),
	api: Symbol('api instance'),
	reader: Symbol('binary encoding reader'),
	writer: Symbol('binary encoding writer'),
	logger: Symbol('logger instance'),
} as const;

@injectable()
/**
 * Helper class to abstract away boilerplate present at the start of every service.
 */
export class DependencyManager {
	public constructor(private readonly env: Env) {
		this.registerDefaultRW();
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

		globalContainer.bind<API>(INJECTION_TOKENS.api).toConstantValue(api);
		return api;
	}

	public registerDefaultRW(): void {
		globalContainer.bind<DataReader>(INJECTION_TOKENS.reader).to(Reader).inTransientScope();
		globalContainer.bind<DataWriter>(INJECTION_TOKENS.writer).to(Writer).inTransientScope();
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
}
