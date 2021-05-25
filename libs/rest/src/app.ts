import polka from 'polka';
import cors from 'cors';
import helmet from 'helmet';
import { container } from 'tsyringe';
import { Config, kConfig } from '@automoderator/injection';
import { logRequests, attachHttpUtils, getPolkaOptions } from './utils';

export const createApp = () => {
  const config = container.resolve<Config>(kConfig);

  return polka(getPolkaOptions()).use(
    cors({
      origin: config.cors,
      credentials: true
    }),
    helmet({ contentSecurityPolicy: config.nodeEnv === 'prod' ? undefined : false }) as any,
    attachHttpUtils(),
    logRequests()
  );
};
