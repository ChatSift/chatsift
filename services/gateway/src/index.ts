import 'reflect-metadata';
import type { DiscordEvents } from '@automoderator/broker-types';
import { GuildMemberCache, MessageCache } from '@automoderator/cache';
import { initConfig, kRedis } from '@automoderator/injection';
import createLogger from '@automoderator/logger';
import { createAmqp, RoutingPublisher, PubSubSubscriber } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { GatewayIntentBits, GatewaySendPayload } from 'discord-api-types/v10';
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

	const gateway = new WebSocketManager({
		token: config.discordToken,
		rest: new REST().setToken(config.discordToken),
		intents:
			GatewayIntentBits.GuildMessages |
			GatewayIntentBits.GuildMembers |
			GatewayIntentBits.GuildBans |
			GatewayIntentBits.MessageContent,
	});

	const panicTimeout = setTimeout(() => {
		logger.debug('Panic');
		process.exit(1);
	}, 60_000).unref();

	gateway
		.on(WebSocketShardEvents.Debug, ({ message, shardId }) => {
			logger.debug({ shardId }, message);
			panicTimeout.refresh();
		})
		.on(WebSocketShardEvents.Hello, ({ shardId }) => logger.debug({ shardId }, 'Shard HELLO'))
		.on(WebSocketShardEvents.Ready, ({ shardId }) => logger.debug({ shardId }, 'Shard READY'))
		.on(WebSocketShardEvents.Resumed, ({ shardId }) => logger.debug({ shardId }, 'Shard RESUMED'))
		.on(WebSocketShardEvents.Dispatch, ({ data }) => {
			panicTimeout.refresh();
			switch (data.t) {
				case 'MESSAGE_CREATE': {
					void messageCache
						.add(data.d)
						.catch((error: unknown) =>
							logger.warn({ error, data: data.d, guild: data.d.guild_id }, 'Failed to cache a message'),
						);

					if (data.d.guild_id && !data.d.webhook_id) {
						void guildMembersCache
							// @ts-expect-error - Common discord-api-types version missmatch
							.add({
								guild_id: data.d.guild_id,
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

			router.publish(data.t, data.d);
		});

	await router.init({ name: 'gateway', topicBased: false });
	await gateway.connect();

	await broadcaster.init({
		name: 'gateway_broadcasts',
		cb: async (packet) => {
			for (const shardId of await gateway.getShardIds()) {
				void gateway.send(shardId, packet);
			}
		},
		fanout: true,
	});
})();
