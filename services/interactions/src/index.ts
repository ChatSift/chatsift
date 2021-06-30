import 'reflect-metadata';

import { createApp, initApp } from '@automoderator/rest';
import { initConfig, kLogger } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import { join as joinPath } from 'path';
import { readdirRecurse } from '@gaius-bot/readdir';
import { createAmqp, RoutingServer } from '@cordis/brokers';

void (async () => {
  const config = initConfig();
  const logger = createLogger('API');

  const { channel } = await createAmqp(config.amqpUrl);
  const interactions = new RoutingServer(channel);

  container.register(RoutingServer, { useValue: interactions });
  container.register(kLogger, { useValue: logger });

  const app = createApp();

  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));
  await interactions.init({ name: 'interactions', topicBased: false });

  app.listen(3002, () => logger.info({ topic: 'INIT' }, 'Listening for interactions on port 3002'));
})();
