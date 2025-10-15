import { getContext } from '@chatsift/backend-core';
import type { RESTGetAPIGatewayBotResult } from '@discordjs/core';
import { GatewayIntentBits, Routes } from '@discordjs/core';
import { CompressionMethod, WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { rest } from './rest.js';

export const gateway = new WebSocketManager({
	token: getContext().env.AMA_BOT_TOKEN,
	intents: GatewayIntentBits.Guilds,
	fetchGatewayInformation: async () => rest.get(Routes.gatewayBot()) as Promise<RESTGetAPIGatewayBotResult>,
	compression: CompressionMethod.ZlibNative,
});

gateway
	.on(WebSocketShardEvents.Closed, (code, shardId) => getContext().logger.info({ shardId, code }, 'Shard CLOSED'))
	.on(WebSocketShardEvents.HeartbeatComplete, ({ ackAt, heartbeatAt, latency }, shardId) =>
		getContext().logger.debug({ shardId, ackAt, heartbeatAt, latency }, 'Shard HEARTBEAT'),
	)
	.on(WebSocketShardEvents.Error, (shardId, error) => getContext().logger.error({ shardId, error }, 'Shard ERROR'))
	.on(WebSocketShardEvents.Debug, (message, shardId) => getContext().logger.debug({ shardId }, message))
	.on(WebSocketShardEvents.Hello, (shardId) => getContext().logger.debug({ shardId }, 'Shard HELLO'))
	.on(WebSocketShardEvents.Ready, (data, shardId) => getContext().logger.debug({ data, shardId }, 'Shard READY'))
	.on(WebSocketShardEvents.Resumed, (shardId) => getContext().logger.debug({ shardId }, 'Shard RESUMED'));
