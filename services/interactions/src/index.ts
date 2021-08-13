import 'reflect-metadata';
import { Rest } from '@automoderator/http-client';
import { initConfig, kLogger, kSql } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createApp, initApp } from '@automoderator/rest';
import { createAmqp, PubSubPublisher } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import { readdirRecurse } from '@gaius-bot/readdir';
import { join as joinPath } from 'path';
import postgres from 'postgres';
import { container } from 'tsyringe';
import { Handler } from './handler';
import { kGatewayBroadcasts } from './util';

void (async () => {
  const config = initConfig();
  const logger = createLogger('interactions');

  const discordRest = new DiscordRest(config.discordToken);

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

  const { channel } = await createAmqp(config.amqpUrl);
  const logs = new PubSubPublisher(channel);
  const gatewayBroadcasts = new PubSubPublisher(channel);

  await logs.init({ name: 'guild_logs', fanout: false });
  await gatewayBroadcasts.init({ name: 'gateway_broadcasts', fanout: true });

  container.register(PubSubPublisher, { useValue: logs });
  container.register(kGatewayBroadcasts, { useValue: gatewayBroadcasts });
  container.register(Rest, { useClass: Rest });
  container.register(DiscordRest, { useValue: discordRest });
  container.register(kLogger, { useValue: logger });
  container.register(
    kSql, {
      useValue: postgres(config.dbUrl, {
        onnotice: notice => logger.debug({ notice }, 'Database notice')
      })
    }
  );

  await container.resolve(Handler).init();

  const app = createApp();
  await initApp(app, readdirRecurse(joinPath(__dirname, 'routes'), { fileExtension: 'js' }));

  app.listen(3002, () => logger.info('Listening for interactions on port 3002'));
})();
