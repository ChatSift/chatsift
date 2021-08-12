import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createApp, initApp } from '@automoderator/rest';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import postgres from 'postgres';
import 'reflect-metadata';
import { container } from 'tsyringe';


void (async () => {
  const config = initConfig();
  const logger = createLogger('auth');

  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ notice }, 'Database notice')
      })
    }
  );

  const app = createApp();

  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));

  app.listen(3000, () => logger.info('Listening to requests on port 3000'));
})();
