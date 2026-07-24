import { getContext } from '@chatsift/backend-core';
import type { GatewayIntentBits, RESTGetAPIGatewayBotResult } from '@discordjs/core';
import { Routes } from '@discordjs/core';
import type { REST } from '@discordjs/rest';
import { CompressionMethod, WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';

export interface CreateBotGatewayOptions {
	readonly intents: GatewayIntentBits;
	readonly rest: REST;
	readonly token: string;
}

export function createBotGateway({ intents, rest, token }: CreateBotGatewayOptions): WebSocketManager {
	const gateway = new WebSocketManager({
		token,
		intents,
		fetchGatewayInformation: async () => rest.get(Routes.gatewayBot()) as Promise<RESTGetAPIGatewayBotResult>,
		compression: CompressionMethod.ZlibNative,
	});

	gateway
		.on(WebSocketShardEvents.Closed, (code, shardId) => getContext().logger.info({ shardId, code }, 'Shard CLOSED'))
		.on(WebSocketShardEvents.HeartbeatComplete, ({ ackAt, heartbeatAt, latency }, shardId) =>
			getContext().logger.debug({ shardId, ackAt, heartbeatAt, latency }, 'Shard HEARTBEAT'),
		)
		.on(WebSocketShardEvents.Error, (error, shardId) => getContext().logger.error({ shardId, error }, 'Shard ERROR'))
		.on(WebSocketShardEvents.Debug, (message, shardId) => getContext().logger.debug({ shardId }, message))
		.on(WebSocketShardEvents.Hello, (shardId) => getContext().logger.debug({ shardId }, 'Shard HELLO'))
		.on(WebSocketShardEvents.Ready, (data, shardId) => getContext().logger.debug({ data, shardId }, 'Shard READY'))
		.on(WebSocketShardEvents.Resumed, (shardId) => getContext().logger.debug({ shardId }, 'Shard RESUMED'));

	return gateway;
}
