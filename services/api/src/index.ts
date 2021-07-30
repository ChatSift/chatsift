import 'reflect-metadata';

import { createApp, initApp, TokenManager } from '@automoderator/rest';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import postgres from 'postgres';
import { join as joinPath } from 'path';
import { readdirRecurse } from '@gaius-bot/readdir';
import { Rest as DiscordRest } from '@cordis/rest';
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

  const discordRest = new DiscordRest(config.discordToken);
  container.register(DiscordRest, { useValue: discordRest });

  discordRest
    .on('response', async (req, res, rl) => {
      if (!res.ok) {
        logger.warn({
          res: await res.json(),
          rl
        }, `Failed request ${req.method!} ${req.path!}`);
      }
    })
    .on('ratelimit', (bucket, endpoint, prevented, waitingFor) => {
      logger.warn({
        bucket,
        prevented,
        waitingFor
      }, `Hit a ratelimit on ${endpoint}`);
    });

  if (config.nodeEnv === 'dev') {
    discordRest.on('request', req => logger.trace(`Making request ${req.method!} ${req.path!}`));
  }

  const app = createApp();

  for (const controller of Object.values(controllers) as any[]) {
    container.register(controller, { useClass: controller });
  }

  container.register(TokenManager, { useClass: TokenManager });

  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));

  app.listen(3001, () => logger.info('Listening to requests on port 3001'));
})();
