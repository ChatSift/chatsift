import 'reflect-metadata';

import { container } from 'tsyringe';
import { Rest } from '@cordis/rest';
import postgres, { Sql } from 'postgres';
import { kLogger, kSql, kRest, initConfig } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import {
  GatewayDispatchEvents,
  RESTGetAPIApplicationCommandsResult,
  RESTPostAPIApplicationCommandsJSONBody,
  RESTPostAPIApplicationCommandsResult,
  Routes
} from 'discord-api-types/v8';
import type { Logger } from 'pino';
import { Gateway } from './gateway';

const main = async () => {
  const config = initConfig();

  const rest = new Rest(config.discordToken);
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

  container.register<Rest>(kRest, { useValue: rest });
  container.register<Sql<{}>>(kSql, { useValue: sql });
  container.register<Logger>(kLogger, { useValue: logger });

  await container.resolve(Gateway).init();
};

void main();
