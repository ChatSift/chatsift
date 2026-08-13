import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import type { GuildListKey } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { onShutdown } from './shutdown.js';

/**
 * How long a claim survives without renewal.
 */
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

/**
 * How long to wait between claiming a primary index and greedily claiming whatever is still free above it.
 */
const SETTLE_MS = 5_000;

const WATCH_INTERVAL_MS = 30_000;
const HOT_SPARE_POLL_MS = 10_000;

/**
 * How long a hot spare's advertisement counts for. Comfortably more than `HOT_SPARE_POLL_MS`.
 */
const SPARE_STALE_MS = 40_000;

/**
 * Sorted set of hot spares waiting for an index, scored by when each last advertised.
 */
const sparesKey = (botId: GuildListKey): string => `shardspares:${botId}`;

const RENEW_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

const leaseKey = (botId: GuildListKey, index: number): string => `shardlease:${botId}:${index}`;

async function advertiseSpare(botId: GuildListKey, token: string): Promise<void> {
	await getContext().redis.zAdd(sparesKey(botId), { score: Date.now(), value: token });
}

async function withdrawSpare(botId: GuildListKey, token: string): Promise<void> {
	await getContext().redis.zRem(sparesKey(botId), token);
}

/**
 * Whether any replica is currently idle and waiting for an index, pruning advertisements that have gone stale.
 */
async function hasWaitingSpare(botId: GuildListKey): Promise<boolean> {
	const { redis } = getContext();
	await redis.zRemRangeByScore(sparesKey(botId), 0, Date.now() - SPARE_STALE_MS);
	return (await redis.zCard(sparesKey(botId))) > 0;
}

/**
 * How many replicas it takes to cover `shardCount` at `shardsPerReplica` each. This is the only place the two
 * numbers meet: Discord's recommendation decides the first, the operator decides the second, and every replica
 * derives the same answer independently rather than being told.
 */
export function computeTotalIndices(shardCount: number, shardsPerReplica: number): number {
	return Math.max(1, Math.ceil(shardCount / shardsPerReplica));
}

/**
 * The shards belonging to a set of replica indices.
 *
 * Index `i` owns exactly `[i * shardsPerReplica, (i + 1) * shardsPerReplica)`, clamped to the real shard count.
 * A flat slice rather than a proportional one, deliberately: it makes an index's meaning **independent of the
 * shard count**, so Discord raising its recommendation from 14 to 15 grows only the tail replica and leaves every
 * other assignment untouched. Dividing the shards proportionally instead would move every boundary on almost any
 * bump, restarting the whole cluster and changing which guilds each replica serves.
 *
 * It also keeps `shardsPerReplica` honest as the capacity bound its name claims, rather than a divisor: a replica
 * never runs more than that many shards unless it is covering for a peer that never claimed its index.
 *
 * The tail replica therefore runs short (14 shards over 4 indices is `4/4/4/2`) until the bot grows into it.
 */
export function shardIdsForIndices(indices: number[], shardCount: number, shardsPerReplica: number): number[] {
	const shardIds: number[] = [];

	for (const index of [...indices].sort((left, right) => left - right)) {
		const start = index * shardsPerReplica;
		const end = Math.min(start + shardsPerReplica, shardCount);
		for (let shardId = start; shardId < end; shardId++) {
			shardIds.push(shardId);
		}
	}

	return shardIds;
}

/**
 * Which replica of this bot this process is.
 *
 * Zero until a slot is claimed, which is also the answer for the only topology that exists by default: one
 * replica owning every shard. Everything that partitions per-replica state (currently the guild list in
 * `backend-core`'s `data/bots.ts`) reads it through here rather than assuming a single writer.
 */
let replicaIndex = 0;
let ownedShardIds: ReadonlySet<number> = new Set();
let totalShardCount = 1;

export function getReplicaIndex(): number {
	return replicaIndex;
}

/**
 * Which shard Discord routes a guild's events to. The formula is Discord's own
 * (`(guild_id >> 22) % num_shards`), so this is a local computation, not a guess.
 */
export function guildShardId(guildId: string, shardCount: number): number {
	return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
}

/**
 * Whether this replica is the one responsible for a guild.
 *
 * Great for avoiding complex atomic logic in tasks like DB sweeps that are tied to a table with a `guild_id`.
 */
export function ownsShardForGuild(guildId: string): boolean {
	if (ownedShardIds.size === 0) {
		return true;
	}

	return ownedShardIds.has(guildShardId(guildId, totalShardCount));
}

export interface ReplicaSlot {
	/**
	 * Every index this replica holds, lowest first, and always a **contiguous run** -- `[2, 3]` is reachable,
	 * `[0, 3]` is not. More than one means it is covering for indices no peer claimed: the cluster is running
	 * fewer replicas than `shardsPerReplica` implies and this replica is carrying the difference rather than
	 * letting those shards go unwatched.
	 */
	readonly heldIndices: number[];
	readonly index: number;
	readonly shardIds: number[];
}

/**
 * Claims this replica's place in the cluster and returns the shards it should run.
 *
 * Every replica runs the identical image and environment; which shards it ends up with is decided here, against
 * redis, rather than configured per container. The sequence is: claim the lowest free index, wait out `SETTLE_MS`
 * so peers starting alongside can claim theirs, then greedily claim whatever is still free immediately above.
 *
 * Complete coverage falls out of that greedy step rather than needing a rule of its own -- an index left
 * unclaimed by a peer that never started is picked up by the replica below it, so once the cluster settles the
 * union of every replica's shards is the full set. The cost of running too few replicas is therefore that
 * somebody works harder, not that a guild goes unwatched. Running too many is equally safe: the surplus finds
 * nothing free and waits as a hot spare.
 *
 * That is the settled state, not a continuous guarantee: a replica that dies takes its shards down until
 * something reclaims its index -- its own restart in the ordinary case, or `startWatching` promoting a neighbour
 * when it is gone for good. Transient dark shards are expected; see docs/roadmap/12-horizontal-scaling.md for how
 * long each case lasts.
 *
 * The known wart is a *straggler*: a replica that starts well after `settleMs` has passed for its peers finds
 * everything already claimed and idles as a hot spare, leaving the cluster correct but unbalanced until the next
 * restart. This is why the intended way to change replica count is `./compose`, which starts them together. It is
 * a balance problem rather than a coverage one, it is logged as a warning when it happens, and it self-corrects
 * on the next deploy -- so it is deliberately not worth the cross-replica negotiation that fixing it live implies.
 */
export async function claimReplicaSlot({
	botId,
	shardCount,
	shardsPerReplica,
	settleMs = SETTLE_MS,
	hotSparePollMs = HOT_SPARE_POLL_MS,
}: {
	readonly botId: GuildListKey;
	readonly hotSparePollMs?: number;
	readonly settleMs?: number;
	readonly shardCount: number;
	readonly shardsPerReplica: number;
}): Promise<ReplicaSlot> {
	const { logger, redis } = getContext();
	const totalIndices = computeTotalIndices(shardCount, shardsPerReplica);
	const token = randomUUID();

	async function tryClaim(index: number): Promise<boolean> {
		const claimed = await redis.set(leaseKey(botId, index), token, {
			condition: 'NX',
			expiration: { type: 'PX', value: LEASE_TTL_MS },
		});

		return Boolean(claimed);
	}

	async function claimLowestFree(): Promise<number | null> {
		for (let index = 0; index < totalIndices; index++) {
			if (await tryClaim(index)) {
				return index;
			}
		}

		return null;
	}

	let primary = await claimLowestFree();
	if (primary === null) {
		// Every index is accounted for, so this replica is surplus to the shard count. Now we idle -- but
		// advertised, not silently: a peer covering two indices watches for this and hands one back.
		logger.warn({ botId, totalIndices, shardCount, shardsPerReplica }, 'no free replica index, idling as a hot spare');

		while (primary === null) {
			await advertiseSpare(botId, token);
			await sleep(hotSparePollMs);
			primary = await claimLowestFree();
		}

		await withdrawSpare(botId, token);
		logger.info({ botId, replicaIndex: primary }, 'hot spare took over a freed replica index');
	}

	const heldIndices = [primary];
	startRenewing(botId, heldIndices, token);

	// No point to wait for the last shard. Also great for single-shard bots.
	if (primary < totalIndices - 1) {
		await sleep(settleMs);
	}

	// Stand down from covering when somebody is idle and able to do it properly. This is what makes a handoff
	// stick: the covering replica restarts to shed an index, and without this it would simply grab the index
	// straight back on the way up -- swapping roles with the spare instead of rebalancing. Suppressing the greedy
	// step (rather than negotiating who takes what) keeps the protocol to one flag: whoever is left over claims
	// what this replica declined, on its next poll.
	if (await hasWaitingSpare(botId)) {
		logger.info({ botId, replicaIndex: primary }, 'a hot spare is waiting, not claiming beyond this index');
	} else {
		for (let index = primary + 1; index < totalIndices; index++) {
			if (!(await tryClaim(index))) {
				break;
			}

			heldIndices.push(index);
		}
	}

	replicaIndex = primary;
	const shardIds = shardIdsForIndices(heldIndices, shardCount, shardsPerReplica);
	ownedShardIds = new Set(shardIds);
	totalShardCount = shardCount;

	logger.info(
		{
			botId,
			replicaIndex: primary,
			heldIndices,
			shardIds,
			shardCount,
			shardsPerReplica,
			totalIndices,
			shardsOwned: shardIds.length,
		},
		shardIds.length > shardsPerReplica ? 'claimed replica slot, covering for missing replicas' : 'claimed replica slot',
	);

	startWatching(botId, heldIndices, totalIndices);
	onShutdown('replica-lease', async () => releaseAll(botId, heldIndices, token));

	return { index: primary, heldIndices, shardIds };
}

/**
 * Re-asserts what indeces this replica is responsible for
 */
function startRenewing(botId: GuildListKey, heldIndices: number[], token: string): void {
	let lastRenewedAt = Date.now();

	setInterval(async () => {
		const { logger, redis } = getContext();

		for (const index of heldIndices) {
			try {
				const renewed = await redis.eval(RENEW_SCRIPT, {
					keys: [leaseKey(botId, index)],
					arguments: [token, String(LEASE_TTL_MS)],
				});

				if (!renewed) {
					logger.error({ botId, index }, 'lost replica lease, restarting to re-derive shard assignment');
					process.kill(process.pid, 'SIGTERM');
					return;
				}
			} catch (error) {
				logger.error({ err: error, botId, index }, 'failed to renew replica lease');

				if (Date.now() - lastRenewedAt > LEASE_TTL_MS) {
					logger.error(
						{ botId, heldIndices, sinceMs: Date.now() - lastRenewedAt },
						'replica lease not renewed for longer than its TTL, restarting',
					);
					process.kill(process.pid, 'SIGTERM');
				}

				return;
			}
		}

		lastRenewedAt = Date.now();
	}, RENEW_INTERVAL_MS).unref();
}

/**
 * Periodically checks if a replica (or more) has disappeared and a set of shards is therefore uncovered.
 * Taking over a free index implies restarting this whole process so `claimReplicaSlot` can re-derive.
 *
 * To avoid complexity, only one replica reacts: whoever holds the index directly below the lowest gap.
 * `claimReplicaSlot` never claims past a live peer, so nobody else could fill it anyway. A gap at index 0
 * has nothing below it, so the lowest remaining holder takes that one.
 */
function startWatching(botId: GuildListKey, heldIndices: number[], totalIndices: number): void {
	let consecutiveGaps = 0;

	setInterval(async () => {
		const { logger, redis } = getContext();

		try {
			const holders = await Promise.all(
				Array.from({ length: totalIndices }, async (_, index) => redis.exists(leaseKey(botId, index))),
			);

			const gaps = holders.flatMap((held, index) => (held ? [] : [index]));
			if (gaps.length === 0) {
				consecutiveGaps = 0;

				// No gaps, but this replica may still be carrying a peer's index while a revived replica idles
				// next to it -- which is where every recovered failure lands, since the index it absorbed stops
				// being a gap the moment it absorbs it. Nothing else would ever notice, so the cluster would run
				// permanently lopsided until the next deploy. Restarting sheds the extras (shutdown releases every
				// held index) and the greedy step stands down on the way back up, leaving them for the spare.
				if (heldIndices.length > 1 && (await hasWaitingSpare(botId))) {
					logger.info(
						{ botId, heldIndices },
						'a hot spare is waiting and this replica is covering extra indices, restarting to hand them over',
					);
					process.kill(process.pid, 'SIGTERM');
				}

				return;
			}

			const firstGap = gaps[0]!;
			const lowestHeld = Math.min(...holders.flatMap((held, index) => (held ? [index] : [])));
			const canFillIt = firstGap === 0 ? lowestHeld === heldIndices[0] : heldIndices.includes(firstGap - 1);
			if (!canFillIt) {
				return;
			}

			consecutiveGaps += 1;
			if (consecutiveGaps < 2) {
				logger.warn({ botId, gaps }, 'replica indices unclaimed, waiting one more check before acting');
				return;
			}

			logger.warn({ botId, gaps }, 'replica indices still unclaimed, restarting to take them over');
			process.kill(process.pid, 'SIGTERM');
		} catch (error) {
			logger.error({ err: error, botId }, 'failed to check replica coverage');
		}
	}, WATCH_INTERVAL_MS).unref();
}

/**
 * Release all our indeces
 */
async function releaseAll(botId: GuildListKey, heldIndices: number[], token: string): Promise<void> {
	const { redis } = getContext();

	await Promise.all(
		heldIndices.map(async (index) =>
			redis.eval(RELEASE_SCRIPT, { keys: [leaseKey(botId, index)], arguments: [token] }),
		),
	);
}
