import 'reflect-metadata';
import { createAmqp, RoutingPublisher } from '@cordis/brokers';
import { initConfig } from '@automoderator/injection';
import type { DiscordEvents } from '@automoderator/core';
import { Cluster } from '@cordis/gateway';
import createLogger from '@automoderator/logger';

void (async () => {
  const config = initConfig();
  const logger = createLogger('gateway');

  const { channel } = await createAmqp(config.amqpUrl);

  const router = new RoutingPublisher<keyof DiscordEvents, DiscordEvents>(channel);
  const gateway = new Cluster(config.discordToken, {
    compress: false,
    encoding: 'json',
    intents: ['guildMessages', 'guildMembers', 'guildBans']
  });

  gateway
    .on('destroy', (reconnecting, fatal, id) => {
      logger.debug({ id, fatal, reconnecting }, 'Shard death');
      if (!reconnecting) {
        process.exit(1);
      }
    })
    .on('open', id => logger.debug({ id }, 'WS connection open'))
    .on('error', (err, id) => logger.debug({ id, err }, 'Encountered a shard errors'))
    .on('ready', () => logger.debug('All shards have become fully available'))
    // @ts-expect-error - Common discord-api-types version missmatch
    .on('dispatch', data => router.publish(data.t, data.d))
    .on('debug', (info, id) => logger.debug({ id }, info));

  await router.init({ name: 'gateway', topicBased: false });
  await gateway.connect();
})();
