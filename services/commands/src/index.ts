import 'reflect-metadata';

import { initConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import createLogger from '@automoderator/logger';
import { container } from 'tsyringe';
import postgres from 'postgres';
import { Handler } from './handler';
import { Rest } from '@automoderator/http-client';

void (async () => {
  const config = initConfig();
  const logger = createLogger('COMMANDS');

  const discordRest = new DiscordRest(config.discordToken);

  discordRest
    .on('response', async (req, res, rl) => {
      if (!res.ok) {
        logger.warn({
          topic: 'REQUEST FAILURE',
          res: await res.json(),
          rl
        }, `Failed request ${req.method!} ${req.path!}`);
      }
    })
    .on('ratelimit', (bucket, endpoint, prevented, waitingFor) => {
      logger.warn({
        topic: 'RATELIMIT',
        bucket,
        prevented,
        waitingFor
      }, `Hit a ratelimit on ${endpoint}`);
    });

  if (config.nodeEnv === 'dev') {
    discordRest.on('request', req => logger.trace({ topic: 'REQUEST START' }, `Making request ${req.method!} ${req.path!}`));
  }

  container.register(Rest, { useClass: Rest });
  container.register(DiscordRest, { useValue: discordRest });
  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ topic: 'DB NOTICE', notice })
      })
    }
  );

  await container.resolve(Handler).init();
  logger.info('Ready to handle slash commands');
})();
