import { Container } from 'inversify';

export const globalContainer = new Container({
	autoBindInjectable: true,
	defaultScope: 'Singleton',
});

export const INJECTION_TOKENS = {
	logger: Symbol('logger instance'),
	/**
	 * @remarks
	 * Not to be used explicitly ever. There should always be abstraction classes for interactions with redis
	 */
	redis: Symbol('redis instance'),
	cacheEntities: {
		guild: Symbol('guild cache entity'),
	},
} as const;
