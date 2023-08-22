import createPinoLogger, { multistream, transport } from 'pino';
import type { PrettyOptions } from 'pino-pretty';

export function createLogger(service: string) {
	const pinoPrettyOptions: PrettyOptions = {
		colorize: true,
		levelFirst: true,
		translateTime: true,
	};

	return createPinoLogger(
		{
			name: service.toUpperCase(),
			level: 'trace',
		},
		multistream([
			{
				stream: transport({
					target: 'pino-pretty',
					options: pinoPrettyOptions,
				}),
				level: 'trace',
			},
		]),
	);
}
