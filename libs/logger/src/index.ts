import createLogger from 'pino';
import { container } from 'tsyringe';
import { Config, kConfig } from '@automoderator/injection';

export default (service: string) => {
  service = service.toUpperCase();

  const { nodeEnv } = container.resolve<Config>(kConfig);
  return createLogger({
    name: service,
    level: nodeEnv === 'prod' ? 'info' : 'trace'
  });
};
