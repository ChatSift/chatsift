import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { Container, inject, injectable } from 'inversify';
import { Redis } from 'ioredis';
import type { DataReader, DataWriter } from '../binary-encoding/Data.js';
import { Reader } from '../binary-encoding/Reader.js';
import { Writer } from '../binary-encoding/Writer.js';
import { Env } from './Env.js';

export const globalContainer = new Container({
	autoBindInjectable: true,
	defaultScope: 'Request',
	skipBaseClassChecks: true,
});

export const INJECTION_TOKENS = {
	redis: Symbol('redis instance'),
	api: Symbol('api instance'),
	reader: Symbol('binary encoding reader'),
	writer: Symbol('binary encoding writer'),
} as const;

@injectable()
/**
 * Helper class to abstract away boilerplate present at the start of every service.
 */
export class DependencyManager {
	@inject(Env)
	public readonly env!: Env;

	public constructor() {
		this.registerDefaultRW();
	}

	public registerRedis(): this {
		globalContainer.bind<Redis>(INJECTION_TOKENS.redis).toConstantValue(new Redis(this.env.redisUrl));
		return this;
	}

	public registerApi(): this {
		const rest = new REST({ api: `${this.env.discordProxyURL}/api`, version: '10' });
		rest.setToken(this.env.discordToken);

		const api = new API(rest);

		globalContainer.bind<API>(INJECTION_TOKENS.api).toConstantValue(api);
		return this;
	}

	public registerDefaultRW(): this {
		globalContainer.bind<DataReader>(INJECTION_TOKENS.reader).to(Reader).inTransientScope();
		globalContainer.bind<DataWriter>(INJECTION_TOKENS.writer).to(Writer).inTransientScope();
		return this;
	}

	public registerAll(): this {
		return this.registerRedis().registerApi();
	}
}
