import { Container } from 'inversify';

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
	actions: {
		restrict: Symbol('restrict action'),
	},
} as const;
