import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import type { GuildListKey } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { onShutdown } from './shutdown.js';

/**
 * How long a claim survives without renewal. Long enough that a replica busy handling a burst of events doesn't
 * lose its shards to a missed tick, short enough that a replica which died without releasing frees them promptly.
 */
const LEASE_TTL_MS = 30_000;
const RENEW_INTERVAL_MS = 10_000;

/**
 * How long to wait between claiming a primary index and greedily claiming whatever is still free above it.
 *
 * This affects *balance only*, never correctness: greedy claims are atomic `SET NX`, so two replicas can never
 * end up holding the same index however the timing falls. Without any wait, whichever replica booted first would
 * claim every index before its peers got started and they would all idle as hot spares -- so this just needs to
 * comfortably cover the spread between replicas in one `docker compose up`.
 */
const SETTLE_MS = 5_000;

const WATCH_INTERVAL_MS = 30_000;
const HOT_SPARE_POLL_MS = 10_000;

/**
 * Renew and release are compare-and-set rather than plain `PEXPIRE`/`DEL`: a replica that stalled long enough for
 * its lease to expire and be re-claimed elsewhere must not then extend or delete somebody else's claim.
 */
const RENEW_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

const leaseKey = (botId: GuildListKey, index: number): string => `shardlease:${botId}:${index}`;

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
 * The tail replica therefore runs short (14 shards over 4 indices is `4/4/4/2`) until the bot grows into it --
 * `4/4/4/3`, `4/4/4/4`, then a fifth index appears. That is headroom, not imbalance.
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
 * Gateway-driven work never needs this -- a replica only receives events for shards it owns, so ownership is
 * enforced by Discord for free. Work driven from the *database* on a timer has no such protection: every replica
 * polls the same tables, so without this every sweep would act on every guild and N replicas would each try to
 * close the same ticket or nuke the same thread.
 *
 * Composes with, rather than replaces, the instance-level `getOwnershipScope`/`resolveForeignOwnerLabel` scoping
 * from #216: that decides which *deployment* owns a guild, this decides which replica of that deployment does.
 *
 * Returns `true` before a slot has been claimed, which is the right answer for a process that owns everything --
 * including `services/api`, which never claims one.
 */
export function ownsShardForGuild(guildId: string): boolean {
	if (ownedShardIds.size === 0) {
		return true;
	}

	return ownedShardIds.has(guildShardId(guildId, totalShardCount));
}

export interface ReplicaSlot {
	/**
	 * Every index this replica holds, lowest first. More than one means it is covering for indices no peer
	 * claimed -- i.e. the cluster is running fewer replicas than `shardsPerReplica` implies, and this replica is
	 * carrying the difference rather than letting those shards go unwatched.
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
	/**
	 * How long to let peers claim before greedily taking what is left. Only ever worth overriding to tune the
	 * balance/startup-latency trade-off described on `SETTLE_MS`; correctness does not depend on it.
	 */
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
	while (primary === null) {
		// Every index is spoken for, so this replica is surplus to the shard count. Idling (rather than exiting)
		// is deliberate: exiting would put the container into a restart loop, whereas a hot spare costs nothing
		// and takes over the moment a peer's lease expires.
		logger.warn({ botId, totalIndices, shardCount, shardsPerReplica }, 'no free replica index, idling as a hot spare');
		await sleep(hotSparePollMs);
		primary = await claimLowestFree();
	}

	const heldIndices = [primary];
	// Renewal starts before the settle wait, not after it. The primary lease is already ticking down from the
	// moment it was claimed, so anything between the claim and the first renew -- the settle wait, a greedy
	// `tryClaim` stalling on slow redis -- eats into its TTL. `startRenewing` reads `heldIndices` fresh on every
	// tick, so the greedy indices pushed below are picked up automatically.
	startRenewing(botId, heldIndices, token);

	// Only worth waiting when there is something above to claim. Holding the highest index (which is every
	// unscaled bot, and so every `yarn dev:*` run) means the greedy step below has nothing to do, and waiting
	// would just add seconds to every boot for no reason.
	if (primary < totalIndices - 1) {
		await sleep(settleMs);
	}

	for (let index = primary + 1; index < totalIndices; index++) {
		if (!(await tryClaim(index))) {
			break;
		}

		heldIndices.push(index);
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
			// The one number worth alerting on: above `shardsPerReplica` means the cluster is short of replicas
			// and this process is absorbing the difference.
			shardsOwned: shardIds.length,
		},
		shardIds.length > shardsPerReplica ? 'claimed replica slot, covering for missing replicas' : 'claimed replica slot',
	);

	startWatching(botId, heldIndices, totalIndices);
	onShutdown('replica-lease', async () => releaseAll(botId, heldIndices, token));

	return { index: primary, heldIndices, shardIds };
}

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
					// Something else holds this index now, so this process is running shards it no longer owns and
					// a peer may already be running them too. Restarting re-derives the assignment from scratch.
					logger.error({ botId, index }, 'lost replica lease, restarting to re-derive shard assignment');
					process.kill(process.pid, 'SIGTERM');
					return;
				}
			} catch (error) {
				// A single failed renew is nothing -- the lease outlives several intervals. But redis being
				// unreachable for longer than the whole TTL means the lease has certainly expired by now and a
				// peer may already have claimed the index, and the CAS above cannot tell us so while redis is
				// still down. Treat sustained failure as a lost lease rather than keeping shards a peer now owns.
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
 * Watches for indices no replica holds, which is what a scaled-down or permanently-dead peer leaves behind.
 *
 * Exactly one replica reacts to a given gap, and it has to be one that can actually *fill* it. Re-derivation
 * claims the lowest free index and then extends upward, stopping at the first index a live peer holds -- so a
 * replica can never jump over a living peer. The replica that can close a gap is therefore the one whose run ends
 * immediately below it (`firstGap - 1`), not the lowest holder in the cluster: with `A[0] B[1] C[2] D[3]` and `C`
 * gone, `A` restarting would reclaim index 0, stop dead at live `B`, and leave index 2 exactly as unclaimed as it
 * found it -- then do it again every interval, bouncing its own shards forever while index 2 stayed dark.
 *
 * A gap at index 0 is the one case with nothing below it, so the lowest holder takes that one.
 *
 * Reacting means restarting, because `@discordjs/ws` cannot add shards to a live manager (`updateShardCount`
 * tears down and respawns everything), so re-deriving on a fresh boot is both simpler and, thanks to the redis
 * session store, nearly free. Gated on the gap surviving two consecutive checks: a single miss is far more likely
 * to be a peer between renewals, or one Docker is already restarting, than a peer that is gone for good.
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

async function releaseAll(botId: GuildListKey, heldIndices: number[], token: string): Promise<void> {
	const { redis } = getContext();

	await Promise.all(
		heldIndices.map(async (index) =>
			redis.eval(RELEASE_SCRIPT, { keys: [leaseKey(botId, index)], arguments: [token] }),
		),
	);
}
