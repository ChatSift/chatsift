import { join } from 'node:path';
import type { Config } from '@automoderator/injection';
import { kConfig } from '@automoderator/injection';
import type { PinoRotateFileOptions } from '@chatsift/pino-rotate-file';
import createLogger, { multistream, transport } from 'pino';
import type { PrettyOptions } from 'pino-pretty';
import { container } from 'tsyringe';
import process from 'node:process';

export default (service: string) => {
	const { nodeEnv } = container.resolve<Config>(kConfig);
	const level = nodeEnv === 'prod' ? 'debug' : 'trace';

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

	return createLogger(
		{
			name: service.toUpperCase(),
			level,
		},
		multistream([
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				stream: transport({
					target: 'pino-pretty',
					options: pinoPrettyOptions,
				}),
				level,
			},
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				stream: transport({
					target: '@chatsift/pino-rotate-file',
					options: pinoRotateFileOptions,
				}),
				level,
			},
		]),
	);
};
