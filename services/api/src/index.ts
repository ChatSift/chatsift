import 'reflect-metadata';

import { createApp, initApp } from '@automoderator/rest';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import postgres from 'postgres';
import { join as joinPath } from 'path';
import { readdirRecurse } from '@gaius-bot/readdir';

void (async () => {
  const config = initConfig();
  const logger = createLogger('API');

  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ topic: 'DB NOTICE', notice })
      })
    }
  );

  const app = createApp();

  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));

  app.listen(3001, () => logger.info({ topic: 'INIT' }, 'Listening to requests on port 3001'));
})();
