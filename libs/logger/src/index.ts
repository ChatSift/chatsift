import createLogger, { LoggerOptions } from 'pino';
import { container } from 'tsyringe';
import { Config, kConfig } from '@automoderator/injection';
import ecsFormat from '@elastic/ecs-pino-format';

export default (service: string) => {
  service = service.toUpperCase();
  const { nodeEnv } = container.resolve<Config>(kConfig);

  const options: LoggerOptions = {
    name: service,
    level: nodeEnv === 'prod' ? 'debug' : 'trace'
  };

  if (nodeEnv === 'prod') {
    Object.assign(options, ecsFormat());
  }

  return createLogger(options);
};
