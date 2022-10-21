import { join } from 'node:path';
import process from 'node:process';
import type { PinoRotateFileOptions } from '@chatsift/pino-rotate-file';
import createPinoLogger, { multistream, transport } from 'pino';
import type { PrettyOptions } from 'pino-pretty';

export function createLogger(service: string) {
	const pinoPrettyOptions: PrettyOptions = {
		colorize: true,
		levelFirst: true,
		translateTime: true,
	};

	const pinoRotateFileOptions: PinoRotateFileOptions = {
		dir: join(process.cwd(), 'logs', service.toLowerCase()),
		mkdir: true,
		maxAgeDays: 14,
		prettyOptions: {
			...pinoPrettyOptions,
			colorize: false,
		},
	};

	return createPinoLogger(
		{
			name: service.toUpperCase(),
			level: 'trace',
		},
		multistream([
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				stream: transport({
					target: 'pino-pretty',
					options: pinoPrettyOptions,
				}),
				level: 'trace',
			},
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				stream: transport({
					target: '@chatsift/pino-rotate-file',
					options: pinoRotateFileOptions,
				}),
				level: 'trace',
			},
		]),
	);
}
