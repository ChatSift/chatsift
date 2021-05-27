import 'reflect-metadata';

import { Route } from './route';
import { kLogger } from '@automoderator/injection';
import { container } from 'tsyringe';
import type { RecursiveDirReadStream } from '@gaius-bot/readdir';
import type { Polka } from 'polka';
import type { Logger } from 'pino';

export const initApp = async (app: Polka, files: RecursiveDirReadStream) => {
  const logger = container.resolve<Logger>(kLogger);

  for await (const file of files) {
    const info = Route.pathToRouteInfo(file.split('/routes').pop()!);
    if (!info) {
      logger.trace({ topic: 'INIT' }, `Hit path with no info: "${file}"`);
      continue;
    }

    const route = container.resolve<Route>((await import(file)).default);
    route.register(info, app);
  }
};
