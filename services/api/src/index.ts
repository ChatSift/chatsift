import 'reflect-metadata';

import { createApp, initApp, TokenManager } from '@automoderator/rest';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import postgres from 'postgres';
import { join as joinPath } from 'path';
import { readdirRecurse } from '@gaius-bot/readdir';
import { createAmqp, RoutingServer } from '@cordis/brokers';
import * as controllers from './controllers';

void (async () => {
  const config = initConfig();
  const logger = createLogger('API');

  const { channel } = await createAmqp(config.amqpUrl);
  const interactions = new RoutingServer(channel);

  container.register(RoutingServer, { useValue: interactions });
  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ topic: 'DB NOTICE', notice })
      })
    }
  );

  const app = createApp();

  for (const controller of Object.values(controllers)) {
    container.register(controller, { useClass: controller });
  }

  container.register(TokenManager, { useClass: TokenManager });

  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));
  await interactions.init({ name: 'interactions', topicBased: false });

  app.listen(3001, () => logger.info({ topic: 'INIT' }, 'Listening to requests on port 3001'));
})();
