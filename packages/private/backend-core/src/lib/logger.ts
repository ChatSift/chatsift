import type { LoggerOptions, TransportTargetOptions } from 'pino';
import { pino as createPinoLogger, transport as pinoTransport, stdTimeFunctions } from 'pino';
import { ENV } from './env.js';

export type { Logger } from 'pino';

/**
 * Split out from `createLogger` so tests can construct a pino instance against a plain in-memory stream (no
 * worker-thread transport) while still exercising the exact same options -- the `redact` config in particular.
 */
export function createLoggerOptions(name: string): LoggerOptions {
	return {
		level: 'trace',
		name,
		timestamp: stdTimeFunctions.isoTime,
		formatters: {
			level: (levelLabel, level) => ({ level, levelLabel }),
		},
		// `@discordjs/rest` errors carry the literal request body (including OAuth `client_secret`/`refresh_token`)
		// on `.requestBody.json` -- redact those specific fields wherever an error ends up logged, regardless of
		// whether it's nested under an explicit `err` key or passed as pino's bare first argument.
		redact: {
			paths: ['err.requestBody.json.client_secret', 'err.requestBody.json.refresh_token'],
			censor: '[REDACTED]',
		},
	};
}

export function createLogger(name: string) {
	// TODO: File rotations for prod?
	const targets: TransportTargetOptions[] = [
		ENV.IS_PRODUCTION
			? {
					target: 'pino/file',
					level: 'trace',
					options: {
						destination: 1, // stdout
					},
				}
			: {
					target: 'pino-pretty',
					level: 'trace',
					options: {
						destination: 1, // stdout
						colorize: true,
						translateTime: 'SYS:standard',
						ignore: 'levelLabel',
					},
				},
	];

	const transport = pinoTransport({
		targets,
		level: 'trace',
	});

	return createPinoLogger(createLoggerOptions(name), transport);
}
