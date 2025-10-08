import type { RESTGetAPIGatewayBotResult } from '@discordjs/core';
import { GatewayIntentBits, Routes } from '@discordjs/core';
import { CompressionMethod, WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { context } from '../context.js';
import { rest } from './rest.js';

export const gateway = new WebSocketManager({
	token: context.env.AMA_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds,
	fetchGatewayInformation: async () => rest.get(Routes.gatewayBot()) as Promise<RESTGetAPIGatewayBotResult>,
	compression: CompressionMethod.ZlibNative,
});

gateway
	.on(WebSocketShardEvents.Closed, (code, shardId) => context.logger.info({ shardId, code }, 'Shard CLOSED'))
	.on(WebSocketShardEvents.HeartbeatComplete, ({ ackAt, heartbeatAt, latency }, shardId) =>
		context.logger.debug({ shardId, ackAt, heartbeatAt, latency }, 'Shard HEARTBEAT'),
	)
	.on(WebSocketShardEvents.Error, (shardId, error) => context.logger.error({ shardId, error }, 'Shard ERROR'))
	.on(WebSocketShardEvents.Debug, (message, shardId) => context.logger.debug({ shardId }, message))
	.on(WebSocketShardEvents.Hello, (shardId) => context.logger.debug({ shardId }, 'Shard HELLO'))
	.on(WebSocketShardEvents.Ready, (data, shardId) => context.logger.debug({ data, shardId }, 'Shard READY'))
	.on(WebSocketShardEvents.Resumed, (shardId) => context.logger.debug({ shardId }, 'Shard RESUMED'));
