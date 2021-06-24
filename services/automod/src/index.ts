import 'reflect-metadata';

import { container } from 'tsyringe';
import { Rest, buildRestRouter, IRouter } from '@cordis/rest';
import postgres, { Sql } from 'postgres';
import { kLogger, kSql, kRest, initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { Gateway } from './gateway';
import type { Logger } from 'pino';

const main = async () => {
  const config = initConfig();

  const rest = new Rest(config.discordToken);
  const router = buildRestRouter(rest);

  const logger = createLogger('AUTOMOD');

  const sql = postgres(config.dbUrl, {
    onnotice: notice => logger.debug({ topic: 'DB NOTICE', notice })
  });

  rest
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
    rest.on('request', req => logger.trace({ topic: 'REQUEST START' }, `Making request ${req.method!} ${req.path!}`));
  }

  container.register<IRouter>(kRest, { useValue: router });
  container.register<Sql<{}>>(kSql, { useValue: sql });
  container.register<Logger>(kLogger, { useValue: logger });

  await container.resolve(Gateway).init();
};

void main();
