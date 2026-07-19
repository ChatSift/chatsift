import type { TransportTargetOptions } from 'pino';
import { pino as createPinoLogger, transport as pinoTransport, stdTimeFunctions } from 'pino';
import { ENV } from './env.js';

export type { Logger } from 'pino';

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

	return createPinoLogger(
		{
			level: 'trace',
			name,
			timestamp: stdTimeFunctions.isoTime,
			formatters: {
				level: (levelLabel, level) => ({ level, levelLabel }),
			},
		},
		transport,
	);
}
