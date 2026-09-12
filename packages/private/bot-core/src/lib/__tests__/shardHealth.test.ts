import { afterEach, expect, test, vi } from 'vitest';
import { stubBackendCoreEnv } from './testEnv.js';

stubBackendCoreEnv();

const { forgetShardHeartbeat, getShardHeartbeat, getShardHealth, recordShardHeartbeat, setOwnedShards } =
	await import('../shardHealth.js');

afterEach(() => {
	vi.useRealTimers();
	setOwnedShards([]);
	for (const shardId of [0, 1, 2]) {
		forgetShardHeartbeat(shardId);
	}
});

test('a replica holding no shards is a healthy spare, not a stalled bot', () => {
	expect(getShardHealth()).toStrictEqual({ state: 'spare', shards: [] });
});

test('a shard that has ACKed recently is healthy, and reports its latency', () => {
	setOwnedShards([0]);
	recordShardHeartbeat(0, { ackAt: Date.now(), latencyMs: 42 });

	const health = getShardHealth();

	expect(health.state).toBe('healthy');
	expect(health.shards).toStrictEqual([{ shardId: 0, latencyMs: 42, ackAgoMs: expect.any(Number) }]);
});

test('an owned shard that has never ACKed is stalled, not absent', () => {
	setOwnedShards([0, 1]);
	recordShardHeartbeat(0, { ackAt: Date.now(), latencyMs: 10 });

	const health = getShardHealth();

	expect(health.state).toBe('stalled');
	expect(health.shards).toStrictEqual([
		{ shardId: 0, latencyMs: 10, ackAgoMs: expect.any(Number) },
		{ shardId: 1, latencyMs: null, ackAgoMs: null },
	]);
});

test('a shard goes stalled once its last ACK ages past the threshold', () => {
	vi.useFakeTimers();
	setOwnedShards([0]);
	recordShardHeartbeat(0, { ackAt: Date.now(), latencyMs: 10 });

	vi.advanceTimersByTime(123_000);
	expect(getShardHealth().state).toBe('healthy');

	vi.advanceTimersByTime(20_000);
	expect(getShardHealth().state).toBe('stalled');
});

test('closing a shard drops its ACK immediately rather than letting it age out', () => {
	setOwnedShards([0]);
	recordShardHeartbeat(0, { ackAt: Date.now(), latencyMs: 10 });
	expect(getShardHealth().state).toBe('healthy');

	forgetShardHeartbeat(0);

	expect(getShardHealth().state).toBe('stalled');
});

test('a shard that stops reporting leaves no stale series behind', async () => {
	const { Gauge, Registry } = await import('prom-client');
	const register = new Registry();

	setOwnedShards([0, 1]);
	recordShardHeartbeat(0, { ackAt: Date.now(), latencyMs: 10 });
	recordShardHeartbeat(1, { ackAt: Date.now(), latencyMs: 20 });

	new Gauge({
		name: 'test_shard_last_ack_seconds',
		help: 'test',
		labelNames: ['shard'] as const,
		registers: [register],
		collect() {
			this.reset();
			for (const shardId of [0, 1]) {
				const heartbeat = getShardHeartbeat(shardId);
				if (heartbeat) {
					this.set({ shard: String(shardId) }, (Date.now() - heartbeat.ackAt) / 1_000);
				}
			}
		},
	});

	expect(await register.metrics()).toContain('shard="1"');

	forgetShardHeartbeat(1);

	const after = await register.metrics();
	expect(after).toContain('shard="0"');
	expect(after).not.toContain('shard="1"');
});
