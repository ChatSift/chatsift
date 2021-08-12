import 'reflect-metadata';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { Rest } from '@cordis/rest';
import postgres from 'postgres';
import { container } from 'tsyringe';
import { Handler } from './handler';

void (async () => {
  const config = initConfig();
  const logger = createLogger('logging');

  const rest = new Rest(config.discordToken);

  rest
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
    rest.on('request', req => logger.trace(`Making request ${req.method!} ${req.path!}`));
  }

  container.register(Rest, { useValue: rest });
  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ notice }, 'Database notice')
      })
    }
  );

  await container.resolve(Handler).init();
  logger.info('Ready to handle logs');
})();
