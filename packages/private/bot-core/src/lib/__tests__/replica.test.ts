import { setTimeout } from 'node:timers';
import { beforeEach, expect, test, vi } from 'vitest';
import { claimReplicaSlot, computeTotalIndices, getReplicaIndex, shardIdsForIndices } from '../replica.js';

const keys = new Map<string, string>();
const info = vi.fn();
const warn = vi.fn();

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		logger: { error: vi.fn(), info, warn },
		redis: {
			async set(key: string, value: string, options?: { condition?: string }) {
				if (options?.condition === 'NX' && keys.has(key)) {
					return null;
				}

				keys.set(key, value);
				return 'OK';
			},
			async exists(key: string) {
				return keys.has(key) ? 1 : 0;
			},
			async eval() {
				return 1;
			},
		},
	}),
}));

vi.mock('../shutdown.js', () => ({ onShutdown: vi.fn() }));

/**
 * One replica booting. `settleMs: 0` because these tests start their peers with `Promise.all` rather than across
 * real time, so there is nothing to wait for.
 */
async function boot(shardCount: number, shardsPerReplica: number) {
	return claimReplicaSlot({ botId: 'AMA', shardCount, shardsPerReplica, settleMs: 0 });
}

beforeEach(() => {
	keys.clear();
	info.mockReset();
	warn.mockReset();
});

test('computeTotalIndices rounds up so no shard is left without an owner', () => {
	expect(computeTotalIndices(14, 4)).toBe(4);
	expect(computeTotalIndices(16, 4)).toBe(4);
	expect(computeTotalIndices(1, 1)).toBe(1);
	// `shardsPerReplica` larger than the shard count is the default (unset) case: one replica takes everything.
	expect(computeTotalIndices(3, 100)).toBe(1);
});

test('computeTotalIndices never returns zero', () => {
	expect(computeTotalIndices(0, 4)).toBe(1);
});

test('shardIdsForIndices gives each index a fixed slice', () => {
	expect(shardIdsForIndices([0], 14, 4)).toStrictEqual([0, 1, 2, 3]);
	expect(shardIdsForIndices([2], 14, 4)).toStrictEqual([8, 9, 10, 11]);
});

test('shardIdsForIndices clamps the final slice to the real shard count', () => {
	// 14 shards over 4-shard slices means index 3 owns two, not four -- asking for shards 14 and 15 would be
	// rejected by Discord.
	expect(shardIdsForIndices([3], 14, 4)).toStrictEqual([12, 13]);
});

test('shardIdsForIndices unions several held indices in shard order', () => {
	expect(shardIdsForIndices([2, 1], 14, 4)).toStrictEqual([4, 5, 6, 7, 8, 9, 10, 11]);
});

test('a lone replica takes every shard', async () => {
	const slot = await boot(14, 4);

	expect(slot.index).toBe(0);
	expect(slot.heldIndices).toStrictEqual([0, 1, 2, 3]);
	expect(slot.shardIds).toHaveLength(14);
	expect(getReplicaIndex()).toBe(0);
});

test('with no SHARDS_PER_REPLICA set the cluster is one replica holding one index', async () => {
	// `createBotGateway` passes `shardsPerReplica: shardCount` when the env var is absent, which has to collapse
	// to exactly today's behaviour -- one index, every shard, same code path.
	const slot = await boot(3, 3);

	expect(slot.heldIndices).toStrictEqual([0]);
	expect(slot.shardIds).toStrictEqual([0, 1, 2]);
});

test('replicas booting together take distinct indices and never overlap', async () => {
	const [first, second, third, fourth] = await Promise.all([boot(14, 4), boot(14, 4), boot(14, 4), boot(14, 4)]);

	const indices = [first, second, third, fourth].map((slot) => slot.index).sort((left, right) => left - right);
	expect(indices).toStrictEqual([0, 1, 2, 3]);

	const allShards = [first, second, third, fourth].flatMap((slot) => slot.shardIds);
	expect(new Set(allShards).size).toBe(allShards.length);
});

test('every shard is covered when the cluster is fully provisioned', async () => {
	const slots = await Promise.all(Array.from({ length: 4 }, async () => boot(14, 4)));

	const covered = slots.flatMap((slot) => slot.shardIds).sort((left, right) => left - right);
	expect(covered).toStrictEqual(Array.from({ length: 14 }, (_, shardId) => shardId));
});

test('every shard is still covered when the cluster is short of replicas', async () => {
	// This is the property the whole greedy-claim step exists for: two replicas where four were intended must
	// still add up to all 14 shards, so being under-provisioned costs effort rather than coverage.
	const slots = await Promise.all(Array.from({ length: 2 }, async () => boot(14, 4)));

	const covered = slots.flatMap((slot) => slot.shardIds).sort((left, right) => left - right);
	expect(covered).toStrictEqual(Array.from({ length: 14 }, (_, shardId) => shardId));
});

test('a replica covering for missing peers holds more than its target and says so', async () => {
	const slot = await boot(14, 4);

	expect(slot.shardIds).toHaveLength(14);
	// Logged as the distinct case it is, so an under-provisioned cluster is visible rather than silent.
	expect(info.mock.calls.at(-1)?.[1]).toBe('claimed replica slot, covering for missing replicas');
});

test('a fully provisioned replica is not reported as covering', async () => {
	const slots = await Promise.all(Array.from({ length: 4 }, async () => boot(14, 4)));

	expect(slots.map((slot) => slot.heldIndices.length)).toStrictEqual([1, 1, 1, 1]);
	expect(info.mock.calls.map((call) => call[1])).not.toContain('claimed replica slot, covering for missing replicas');
});

test('indices are claimed lowest-first so index 0 always has an owner', async () => {
	// Coverage is only guaranteed because a gap can never open below a claimed index -- if claiming picked
	// arbitrary indices, shard 0 could go unwatched while index 3 was held.
	const slots = await Promise.all(Array.from({ length: 3 }, async () => boot(16, 4)));

	expect(slots.map((slot) => slot.index).sort((left, right) => left - right)).toStrictEqual([0, 1, 2]);
	expect(slots.flatMap((slot) => slot.shardIds)).toContain(0);
});

test('a straggler that finds nothing free waits as a hot spare, then takes over when a slot frees', async () => {
	// A replica starting long after its peers is the one case greedy claiming handles badly: the cluster is
	// already fully covered, so this one has nothing to do. Idling (rather than exiting) is what keeps Docker
	// from restart-looping it, and means it takes over the moment a peer's lease lapses.
	await boot(16, 4);

	const straggler = claimReplicaSlot({
		botId: 'AMA',
		shardCount: 16,
		shardsPerReplica: 4,
		settleMs: 0,
		hotSparePollMs: 5,
	});

	// Simulates a peer's lease expiring while the spare is polling.
	setTimeout(() => keys.delete('shardlease:AMA:2'), 20);

	await expect(straggler).resolves.toMatchObject({ index: 2, shardIds: [8, 9, 10, 11] });
	expect(warn.mock.calls[0]?.[1]).toBe('no free replica index, idling as a hot spare');
});
