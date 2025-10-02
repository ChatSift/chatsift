import type { TransportTargetOptions } from 'pino';
import { pino as createPinoLogger, transport as pinoTransport, stdTimeFunctions } from 'pino';

export function createLogger(name: string) {
	// TODO: File rotations for prod?
	const targets: TransportTargetOptions[] = [
		{
			target: 'pino/file',
			level: 'trace',
			options: {
				destination: 1, // stdout
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
