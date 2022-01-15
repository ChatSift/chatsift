/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

import { Config, kConfig } from '@automoderator/injection';
import ecsFormat from '@elastic/ecs-pino-format';
import createLogger, { LoggerOptions } from 'pino';
// @ts-expect-error
import pinoElastic from 'pino-elasticsearch';
import { multistream, Streams } from 'pino-multi-stream';
import pinoPretty from 'pino-pretty';
import { container } from 'tsyringe';
import { inspect } from 'util';

export default (service: string) => {
	const { nodeEnv, elasticUrl, elasticUsername, elasticPassword } = container.resolve<Config>(kConfig);

	const options: LoggerOptions = {
		name: service.toUpperCase(),
		customLevels: {
			metric: 19,
		},
		level: nodeEnv === 'prod' ? 'metric' : 'trace',
		prettyPrint: nodeEnv !== 'prod',
	};

	const streams: Streams = [];

	if (nodeEnv === 'prod') {
		Object.assign(options, ecsFormat());

		const getElasticStream = (index: string) =>
			(
				pinoElastic({
					index: index,
					consistency: 'one',
					node: elasticUrl,
					auth: {
						username: elasticUsername,
						password: elasticPassword,
					},
					'es-version': 7,
				}) as NodeJS.WriteStream
			)
				.on('unknown', (line: number, error) =>
					console.error(`[${index}] Elasticsearch client json error in line:\n${line}\nError:`, error),
				)
				.on('error', (error) => console.error(`[${index}] Elasticsearch client error:`, error))
				.on('insertError', (error) =>
					console.error(`[${index}] Elasticsearch server error:`, error, inspect(error.document, true, Infinity)),
				);

		const logsStream = getElasticStream(`logs-${service}`);

		streams.push(
			{ level: 'metric' as createLogger.LevelWithSilent, stream: getElasticStream(`metrics-${service}`) },
			{ level: 'debug', stream: logsStream },
			{ level: 'info', stream: logsStream },
			{ level: 'warn', stream: logsStream },
			{ level: 'error', stream: logsStream },
			{ level: 'fatal', stream: logsStream },
		);
	}

	Object.assign(options, { prettifier: pinoPretty });
	streams.push({ level: 'trace', stream: process.stdout });

	return createLogger(
		options,
		multistream(streams, {
			dedupe: true,
			// @ts-expect-error
			levels: {
				silent: Infinity,
				fatal: 60,
				error: 50,
				warn: 50,
				info: 30,
				debug: 20,
				metric: 19,
				trace: 10,
			},
		}),
	);
};
