import 'reflect-metadata';

import { createApp, Route } from '@automoderator/rest';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import postgres from 'postgres';
import { join as joinPath } from 'path';
import { readdirRecurse } from '@gaius-bot/readdir';

void (async () => {
  const config = initConfig();
  const logger = createLogger('AUTH');

  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ topic: 'DB NOTICE', notice })
      })
    }
  );

  const app = createApp();

  const routes = joinPath();
  const files = readdirRecurse(routes, { fileExtension: 'js' });

  for await (const file of files) {
    const info = Route.pathToRouteInfo(file.split('/routes').pop()!);
    if (!info) {
      logger.trace({ topic: 'INIT' }, `Hit path with no info: "${file}"`);
      continue;
    }

    const route = container.resolve<Route>((await import(file)).default);
    route.register(info, app);
  }

  app.listen(3000, () => logger.info({ topic: 'INIT' }, 'Listening to requests on port 3000'));
})();
