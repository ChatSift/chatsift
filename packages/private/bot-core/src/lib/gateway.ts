import type { GuildListKey } from '@chatsift/backend-core';
import { ENV, getContext } from '@chatsift/backend-core';
import type { GatewayIntentBits, RESTGetAPIGatewayBotResult } from '@discordjs/core';
import { Routes } from '@discordjs/core';
import type { REST } from '@discordjs/rest';
import { CompressionMethod, WebSocketManager, WebSocketShardEvents } from '@discordjs/ws';
import { Gauge, type Registry } from 'prom-client';
import { createRedisIdentifyThrottler } from './identifyThrottler.js';
import { claimReplicaSlot } from './replica.js';
import { retrieveSessionInfo, startSessionStore, updateSessionInfo } from './sessions.js';
import { forgetShardHeartbeat, getShardHeartbeat, recordShardHeartbeat } from './shardHealth.js';
import { onShutdown } from './shutdown.js';

export interface CreateBotGatewayOptions {
	readonly botId: GuildListKey;
	readonly intents: GatewayIntentBits;
	/**
	 * Optional for the same reason `createBotRest`'s is: the gateway has to stand up without one in tests.
	 * Omitting it drops the two heartbeat gauges, nothing else.
	 */
	readonly register?: Registry;
	readonly rest: REST;
	readonly token: string;
}

function registerHeartbeatMetrics(botId: GuildListKey, shardIds: number[], register: Registry): void {
	const bot = botId.split('#')[0]!;

	new Gauge({
		name: 'discord_shard_heartbeat_latency_seconds',
		help: 'Round trip of the last completed gateway heartbeat, by shard',
		labelNames: ['bot', 'shard'] as const,
		registers: [register],
		collect() {
			this.reset();
			for (const shardId of shardIds) {
				const heartbeat = getShardHeartbeat(shardId);
				if (heartbeat) {
					this.set({ bot, shard: String(shardId) }, heartbeat.latencyMs / 1_000);
				}
			}
		},
	});

	new Gauge({
		name: 'discord_shard_last_ack_seconds',
		help: 'Seconds since the last completed gateway heartbeat, by shard',
		labelNames: ['bot', 'shard'] as const,
		registers: [register],
		collect() {
			this.reset();
			const now = Date.now();
			for (const shardId of shardIds) {
				const heartbeat = getShardHeartbeat(shardId);
				if (heartbeat) {
					this.set({ bot, shard: String(shardId) }, (now - heartbeat.ackAt) / 1_000);
				}
			}
		},
	});
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
	register,
	rest,
	token,
}: CreateBotGatewayOptions): Promise<WebSocketManager> {
	startSessionStore(botId);

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
		retrieveSessionInfo,
		updateSessionInfo,
		buildIdentifyThrottler: async (manager) =>
			createRedisIdentifyThrottler(
				botId,
				(await manager.fetchGatewayInformation()).session_start_limit.max_concurrency,
			),
	});

	if (register) {
		registerHeartbeatMetrics(botId, shardIds, register);
	}

	gateway
		.on(WebSocketShardEvents.Closed, (code, shardId) => {
			forgetShardHeartbeat(shardId);
			getContext().logger.info({ shardId, code }, 'Shard CLOSED');
		})
		.on(WebSocketShardEvents.HeartbeatComplete, ({ ackAt, latency }, shardId) =>
			recordShardHeartbeat(shardId, { ackAt, latencyMs: latency }),
		)
		.on(WebSocketShardEvents.Error, (error, shardId) => getContext().logger.error({ shardId, error }, 'Shard ERROR'))
		.on(WebSocketShardEvents.Debug, (message, shardId) => getContext().logger.debug({ shardId }, message))
		.on(WebSocketShardEvents.Hello, (shardId) => getContext().logger.debug({ shardId }, 'Shard HELLO'))
		.on(WebSocketShardEvents.Ready, (data, shardId) => getContext().logger.debug({ data, shardId }, 'Shard READY'))
		.on(WebSocketShardEvents.Resumed, (shardId) => getContext().logger.debug({ shardId }, 'Shard RESUMED'));

	return gateway;
}
