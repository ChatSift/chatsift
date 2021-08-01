import createLogger, { LoggerOptions } from 'pino';
import { container } from 'tsyringe';
import { Config, kConfig } from '@automoderator/injection';
import ecsFormat from '@elastic/ecs-pino-format';
import { multistream, Streams } from 'pino-multi-stream';
import pinoPretty from 'pino-pretty';
// @ts-expect-error
import pinoElastic from 'pino-elasticsearch';

export default (service: string) => {
  const { nodeEnv, elasticUrl } = container.resolve<Config>(kConfig);

  const options: LoggerOptions = {
    name: service.toUpperCase(),
    customLevels: {
      metric: 70
    },
    level: nodeEnv === 'prod' ? 'debug' : 'trace',
    prettyPrint: nodeEnv !== 'prod'
  };

  const streams: Streams = [];

  if (nodeEnv === 'prod') {
    Object.assign(options, ecsFormat());

    const getElasticStream = (index: string) =>
      (pinoElastic({
        'index': index,
        'consistency': 'one',
        'node': elasticUrl,
        'es-version': 7
      }) as NodeJS.WriteStream)
        .on('unknown', (line, error) => {
          console.error(`[${index}] Elasticsearch client json error in line:\n${line}\nError:`, error);
        })
        .on('error', error => {
          console.error(`[${index}] Elasticsearch client error:`, error);
        })
        .on('insertError', error => {
          console.error(`[${index}] Elasticsearch server error:`, error);
        });

    streams.push(
      { level: 'debug', stream: getElasticStream(`logs-${service}`) },
      { level: 'metric' as any, stream: getElasticStream('metrics') }
    );
  } else {
    Object.assign(options, { prettifier: pinoPretty });
    streams.push({ level: 'trace', stream: process.stdout });
  }

  return createLogger(options, multistream(streams, { dedupe: true }));
};
