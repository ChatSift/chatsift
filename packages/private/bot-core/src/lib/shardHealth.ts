/**
 * How long a shard may go without completing a heartbeat before it counts as stalled.
 */
const STALE_AFTER_MS = 135_000;

export interface ShardHeartbeat {
	readonly ackAt: number;
	readonly latencyMs: number;
}

const heartbeats = new Map<number, ShardHeartbeat>();

let ownedShardIds: ReadonlySet<number> = new Set();

export function setOwnedShards(shardIds: Iterable<number>): void {
	ownedShardIds = new Set(shardIds);
}

export function recordShardHeartbeat(shardId: number, heartbeat: ShardHeartbeat): void {
	heartbeats.set(shardId, heartbeat);
}

/**
 * Drops a shard's last ACK when its socket closes, so a shard that goes away stops reading as recently-healthy
 * for the remainder of `STALE_AFTER_MS`. The reconnect repopulates it on the first completed beat.
 */
export function forgetShardHeartbeat(shardId: number): void {
	heartbeats.delete(shardId);
}

export function getShardHeartbeat(shardId: number): ShardHeartbeat | undefined {
	return heartbeats.get(shardId);
}

/**
 * `spare` is a healthy state, not a degraded one
 */
export type ShardHealthState = 'healthy' | 'spare' | 'stalled';

export interface ShardHealth {
	readonly shards: { ackAgoMs: number | null; latencyMs: number | null; shardId: number }[];
	readonly state: ShardHealthState;
}

/**
 * Whether this process is doing the job it claimed a slot to do.
 *
 * Reads the owned set rather than the recorded beats, so a shard that has never completed one is stalled rather
 * than invisible. Docker's `start_period` covers the boot window, which is why there is no separate "starting"
 * state here -- a bot that has claimed its slot but not yet identified is not serving.
 */
export function getShardHealth(): ShardHealth {
	if (ownedShardIds.size === 0) {
		return { state: 'spare', shards: [] };
	}

	const now = Date.now();
	const shards = [...ownedShardIds]
		.sort((left, right) => left - right)
		.map((shardId) => {
			const heartbeat = heartbeats.get(shardId);

			return {
				shardId,
				latencyMs: heartbeat?.latencyMs ?? null,
				ackAgoMs: heartbeat ? now - heartbeat.ackAt : null,
			};
		});

	const stalled = shards.some(({ ackAgoMs }) => ackAgoMs === null || ackAgoMs > STALE_AFTER_MS);

	return { state: stalled ? 'stalled' : 'healthy', shards };
}
