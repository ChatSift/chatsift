import 'reflect-metadata';

import { createApp, initApp, TokenManager } from '@automoderator/rest';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import postgres from 'postgres';
import { join as joinPath } from 'path';
import { readdirRecurse } from '@gaius-bot/readdir';
import * as controllers from './controllers';

void (async () => {
  const config = initConfig();
  const logger = createLogger('API');

  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ notice }, 'Database notice')
      })
    }
  );

  const app = createApp();

  for (const controller of Object.values(controllers) as any[]) {
    container.register(controller, { useClass: controller });
  }

  container.register(TokenManager, { useClass: TokenManager });

  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));

  app.listen(3001, () => logger.info('Listening to requests on port 3001'));
})();
