import { Config, kConfig } from '@automoderator/injection';
import { join } from 'path';
import createLogger, { multistream, transport } from 'pino';
import pinoPretty from 'pino-pretty';
import { container } from 'tsyringe';

export default (service: string) => {
	const { nodeEnv } = container.resolve<Config>(kConfig);
	return createLogger(
		{
			name: service.toUpperCase(),
			level: nodeEnv === 'prod' ? 'debug' : 'trace',
		},
		multistream([
			{
				stream: pinoPretty({
					colorize: true,
					levelFirst: true,
					translateTime: true,
				}),
				level: 'debug',
			},
			{
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				stream: transport({
					target: 'pino/file',
					options: {
						destination: join(process.cwd(), 'logs', `${service}.log`),
						mkdir: true,
					},
				}),
				level: 'debug',
			},
		]),
	);
};
