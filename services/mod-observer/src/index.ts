import 'reflect-metadata';
import { Rest } from '@automoderator/http-client';
import { initConfig, kLogger, kRedis, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { Rest as DiscordRest } from '@cordis/rest';
import type { Logger } from 'pino';
import postgres, { Sql } from 'postgres';
import { container } from 'tsyringe';
import { Gateway } from './gateway';
import Redis, { Redis as IORedis } from 'ioredis';

void (async () => {
  const config = initConfig();
  container.register(Rest, { useClass: Rest });

  const discordRest = new DiscordRest(config.discordToken);

  const logger = createLogger('mod-observer');

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
  container.register<IORedis>(kRedis, { useValue: new Redis(config.redisUrl) });
  container.register<Sql<{}>>(kSql, { useValue: sql });
  container.register<Logger>(kLogger, { useValue: logger });

  await container.resolve(Gateway).init();
  logger.info('Ready to listen to manual mod actions');
})();
