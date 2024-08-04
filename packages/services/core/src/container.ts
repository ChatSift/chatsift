import { Container } from 'inversify';

export const globalContainer = new Container({
	autoBindInjectable: true,
	defaultScope: 'Singleton',
});

export const INJECTION_TOKENS = {
	logger: Symbol('logger instance'),
	redis: Symbol('redis instance'),
	env: Symbol('env'),
} as const;
