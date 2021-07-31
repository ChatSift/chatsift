import createLogger, { LoggerOptions } from 'pino';
import { container } from 'tsyringe';
import { Config, kConfig } from '@automoderator/injection';
import ecsFormat from '@elastic/ecs-pino-format';
import { multistream, Streams } from 'pino-multi-stream';
import pinoPretty from 'pino-pretty';
// @ts-expect-error
import pinoElastic from 'pino-elasticsearch';

type Stream = Streams extends (infer T)[] ? T : never;

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

    const getElasticStream = (index: string): Stream => ({
      level: 'debug',
      stream: pinoElastic({
        'index': index,
        'consistency': 'one',
        'node': elasticUrl,
        'es-version': 7
      })
    });

    streams.push(getElasticStream(`${service}-logs`), getElasticStream('metrics'));
  } else {
    Object.assign(options, { prettifier: pinoPretty });
    streams.push({ level: 'trace', stream: process.stdout });
  }

  return createLogger(options, multistream(streams));
};
