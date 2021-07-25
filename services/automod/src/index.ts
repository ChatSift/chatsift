import 'reflect-metadata';

import { container } from 'tsyringe';
import { Rest as DiscordRest } from '@cordis/rest';
import postgres, { Sql } from 'postgres';
import { kLogger, kSql, initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { Gateway } from './gateway';
import * as runners from './runners';
import { Rest } from '@automoderator/http-client';
import type { Logger } from 'pino';

void (async () => {
  const config = initConfig();
  container.register(Rest, { useClass: Rest });

  const discordRest = new DiscordRest(config.discordToken);

  const logger = createLogger('AUTOMOD');

  const sql = postgres(config.dbUrl, {
    onnotice: notice => logger.debug({ notice }, 'Database notice')
  });

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

  container.register(DiscordRest, { useValue: discordRest });
  container.register<Sql<{}>>(kSql, { useValue: sql });
  container.register<Logger>(kLogger, { useValue: logger });
  for (const runner of Object.values(runners)) {
    // @ts-expect-error - tsyringe typings are screwed
    container.register(runner, { useClass: runner });
  }

  await container.resolve(Gateway).init();
  logger.info('Ready to listen to message packets');
})();
