import 'reflect-metadata';
import { randomBytes } from 'crypto';
import { createLogger, Env } from '@automoderator/common';
import { REST } from '@discordjs/rest';
import { WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { Redis as Broker } from '@spectacles/brokers';
import { GatewayIntentBits, GatewaySendPayload } from 'discord-api-types/v10';
import Redis from 'ioredis';
import { container } from 'tsyringe';

const logger = createLogger('gateway');

const env = container.resolve(Env);
const redis = new Redis(env.redisUrl);

// Want a random group name so we fan out gateway_send payloads
const broker = new Broker(randomBytes(16).toString('hex'), redis);

const gateway = new WebSocketManager({
	token: env.discordToken,
	rest: new REST().setToken(env.discordToken),
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
broker.on('gateway_send', async (payload: GatewaySendPayload) => {
	for (const shardId of await gateway.getShardIds()) {
		await gateway.send(shardId, payload);
	}
});

await broker.subscribe(['gateway_send']);

await gateway.connect();
