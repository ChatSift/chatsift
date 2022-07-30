import 'reflect-metadata';
import type { DiscordEvents } from '@automoderator/broker-types';
import { GuildMemberCache, MessageCache } from '@automoderator/cache';
import { initConfig, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createAmqp, RoutingPublisher, PubSubSubscriber } from '@cordis/brokers';
import { Cluster } from '@cordis/gateway';
import type { GatewaySendPayload } from 'discord-api-types/v9';
import Redis from 'ioredis';
import { container } from 'tsyringe';

void (async () => {
	const config = initConfig();
	const logger = createLogger('gateway');

	const { channel } = await createAmqp(config.amqpUrl);

	const router = new RoutingPublisher<keyof DiscordEvents, DiscordEvents>(channel);
	const broadcaster = new PubSubSubscriber<GatewaySendPayload>(channel);

	const redis = new Redis(config.redisUrl);
	container.register(kRedis, { useValue: redis });

	const guildMembersCache = container.resolve(GuildMemberCache);
	const messageCache = container.resolve(MessageCache);

	const gateway = new Cluster(config.discordToken, {
		compress: false,
		encoding: 'json',
		intents: ['guildMessages', 'guildMembers', 'guildBans'],
	});

	gateway
		.on('destroy', (reconnecting, fatal, id) => {
			logger.debug({ id, fatal, reconnecting }, 'Shard death');
			if (!reconnecting) {
				process.exit(1);
			}
		})
		.on('open', (id) => logger.debug({ id }, 'WS connection open'))
		.on('error', (err: unknown, id) => logger.debug({ id, err }, 'Encountered a shard error'))
		.on('ready', () => logger.debug('All shards have become fully available'))
		.on('dispatch', (data) => {
			switch (data.t) {
				case 'MESSAGE_CREATE': {
					void messageCache
						// @ts-expect-error - Common discord-api-types version missmatch
						.add(data.d)
						.catch((error: unknown) =>
							logger.warn({ error, data: data.d, guild: data.d.guild_id }, 'Failed to cache a message'),
						);

					if (data.d.guild_id && !data.d.webhook_id) {
						void guildMembersCache
							.add({
								guild_id: data.d.guild_id,
								// @ts-expect-error - Common discord-api-types version missmatch
								user: data.d.author,
								...data.d.member,
							})
							.catch((error: unknown) =>
								logger.warn({ error, data: data.d, guild: data.d.guild_id }, 'Failed to cache a guild member'),
							);
					}

					break;
				}

				case 'MESSAGE_UPDATE': {
					if (data.d.guild_id && !data.d.webhook_id && data.d.author && data.d.member) {
						void guildMembersCache
							.add({
								guild_id: data.d.guild_id,
								// @ts-expect-error - Common discord-api-types version missmatch
								user: data.d.author,
								...data.d.member,
							})
							.catch((error: unknown) =>
								logger.warn({ error, data: data.d, guild: data.d.guild_id }, 'Failed to cache a guild member'),
							);
					}
				}

				default:
					break;
			}

			// @ts-expect-error - Common discord-api-types version missmatch
			router.publish(data.t, data.d);
		})
		.on('debug', (info, id) => logger.debug({ id }, info as string));

	await router.init({ name: 'gateway', topicBased: false });
	await gateway.connect();

	await broadcaster.init({
		name: 'gateway_broadcasts',
		// @ts-expect-error - Common discord-api-types version missmatch
		cb: (packet) => gateway.broadcast(packet),
		fanout: true,
	});
})();
