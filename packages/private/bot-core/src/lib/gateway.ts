import type { GuildListKey } from '@chatsift/backend-core';
import { ENV, getContext } from '@chatsift/backend-core';
import type { GatewayIntentBits, RESTGetAPIGatewayBotResult } from '@discordjs/core';
import { Routes } from '@discordjs/core';
import type { REST } from '@discordjs/rest';
import { CompressionMethod, WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { createRedisIdentifyThrottler } from './identifyThrottler.js';
import { claimReplicaSlot } from './replica.js';
import { createSessionStore } from './sessions.js';
import { onShutdown } from './shutdown.js';

export interface CreateBotGatewayOptions {
	readonly botId: GuildListKey;
	readonly intents: GatewayIntentBits;
	readonly rest: REST;
	readonly token: string;
}

/**
 * Builds this bot's `WebSocketManager`, including working out which shards *this replica* is responsible for.
 *
 * Scaling out is meant to be a configuration change rather than a code change, so there is deliberately no branch
 * here between "one process" and "many": every bot goes through the same claim against redis, and with
 * `SHARDS_PER_REPLICA` unset it resolves to one replica holding every shard -- which is what all four bots do
 * today. The path production would use when scaled is therefore the same path dev exercises on every run, rather
 * than a second mode that only ever runs where nobody can watch it.
 */
export async function createBotGateway({
	botId,
	intents,
	rest,
	token,
}: CreateBotGatewayOptions): Promise<WebSocketManager> {
	const sessions = createSessionStore(botId);

	// Fetched here rather than left to the manager because the shard count is an *input* to the claim below --
	// this replica cannot know which slice is its own until it knows how many there are. The manager fetches it
	// again for itself, which is one extra request once per boot.
	const gatewayInformation = (await rest.get(Routes.gatewayBot())) as RESTGetAPIGatewayBotResult;
	const shardCount = gatewayInformation.shards;
	const { shardIds } = await claimReplicaSlot({
		botId,
		shardCount,
		shardsPerReplica: ENV.SHARDS_PER_REPLICA ?? shardCount,
	});

	const gateway = new WebSocketManager({
		token,
		intents,
		fetchGatewayInformation: async () => rest.get(Routes.gatewayBot()) as Promise<RESTGetAPIGatewayBotResult>,
		compression: CompressionMethod.ZlibNative,
		shardCount,
		shardIds,
		retrieveSessionInfo: async (shardId) => sessions.retrieveSessionInfo(shardId),
		updateSessionInfo: async (shardId, sessionInfo) => sessions.updateSessionInfo(shardId, sessionInfo),
		buildIdentifyThrottler: async (manager) =>
			createRedisIdentifyThrottler(
				botId,
				(await manager.fetchGatewayInformation()).session_start_limit.max_concurrency,
			),
	});

	// Flushing on shutdown is what turns a planned restart into a RESUME from the exact sequence it stopped at,
	// rather than one up to a flush interval stale. See `lib/sessions.ts` for why the store is write-behind, and
	// `lib/shutdown.ts` for why the gateway itself is deliberately not destroyed here.
	onShutdown('gateway-sessions', async () => sessions.flush());

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
