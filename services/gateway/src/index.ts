import 'reflect-metadata';
import { randomBytes } from 'crypto';
import { createLogger, Env, DiscordEventsMap, encode, decode } from '@automoderator/common';
import { PubSubRedisBroker } from '@discordjs/brokers';
import { REST } from '@discordjs/rest';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { GatewayIntentBits } from 'discord-api-types/v10';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import { ProxyAgent } from 'undici';

const logger = createLogger('gateway');

const env = container.resolve(Env);
const redis = new Redis(env.redisUrl);

// Want a random group name so we fan out gateway_send payloads
const broker = new PubSubRedisBroker<DiscordEventsMap>({ redisClient: redis, encode, decode });

const gateway = new WebSocketManager({
	token: env.discordToken,
	rest: new REST().setToken(env.discordToken).setAgent(new ProxyAgent(env.discordProxyURL)),
	intents:
		GatewayIntentBits.GuildMessages |
		GatewayIntentBits.GuildMembers |
		GatewayIntentBits.GuildBans |
		GatewayIntentBits.MessageContent,
});

gateway
	.on(WebSocketShardEvents.Debug, ({ message, shardId }) => logger.debug({ shardId }, message))
	.on(WebSocketShardEvents.Hello, ({ shardId }) => logger.debug({ shardId }, 'Shard HELLO'))
	.on(WebSocketShardEvents.Ready, ({ shardId }) => logger.debug({ shardId }, 'Shard READY'))
	.on(WebSocketShardEvents.Resumed, ({ shardId }) => logger.debug({ shardId }, 'Shard RESUMED'))
	.on(WebSocketShardEvents.Dispatch, ({ data }) => void broker.publish(data.t, data.d));

// eslint-disable-next-line @typescript-eslint/no-misused-promises
broker.on('send', async ({ data, ack }) => {
	for (const shardId of await gateway.getShardIds()) {
		await gateway.send(shardId, data);
	}

	await ack();
});

await broker.subscribe(randomBytes(16).toString('hex'), ['send']);
await gateway.connect();
