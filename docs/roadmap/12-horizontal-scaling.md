# Horizontal scaling for bots (`@chatsift/bot-core`)

**Depends on:** nothing. **Blocks:** [11-automoderator-port.md](11-automoderator-port.md) P8, which was written
against a mechanism that did not exist yet. **Live production impact:** none by default — every bot behaves
exactly as before until a `<BOT>_SHARDS_PER_REPLICA` value is set.

## Status: implemented

## What this is

Every bot can now run as N identical replicas, each owning a slice of the gateway shards. Which slice is decided
at boot against redis, not configured per container.

The design goal that shaped everything else: **scaling out is a configuration change, and the scaled code path is
the one dev runs every day.** There is deliberately no `if (shards === 1)` branch anywhere. With
`SHARDS_PER_REPLICA` unset a bot claims a single index covering every shard, which is byte-for-byte today's
behaviour — but it gets there through the same claim, the same redis keys and the same session store that a
16-shard deployment uses. A scaling path that only executes in production is a scaling path nobody has tested.

## The one number a human sets

`<BOT>_SHARDS_PER_REPLICA` in `.env.public`. Everything else is derived:

```
shardCount   <- GET /gateway/bot            (Discord's own recommendation)
replicaCount <- ceil(shardCount / SHARDS_PER_REPLICA)   (computed by ./compose, passed as --scale)
myShards     <- claimed against redis        (computed by each replica, independently)
```

`./compose up` reads `/gateway/bot` host-side and passes `--scale <service>=N`. Host-side matters: this box
already has docker access, so nothing needs `/var/run/docker.sock` mounted into a container that processes
untrusted Discord input.

## How a replica finds its shards

`packages/private/bot-core/src/lib/replica.ts`.

1. Claim the lowest free index in `[0, totalIndices)` with `SET NX PX`.
2. Wait out a settle window so peers starting alongside can claim theirs.
3. Greedily claim any index still free immediately above.
4. Own the union of the fixed slices belonging to every index held.

```
shardCount=14, SHARDS_PER_REPLICA=4  ->  totalIndices=4

4 replicas:  idx0 [0-3]  idx1 [4-7]  idx2 [8-11]  idx3 [12,13]
3 replicas:  idx0 [0-3]  idx1 [4-7]  idx2 [8-13]        <- absorbs the tail
5 replicas:  the surplus finds nothing free and waits as a hot spare
```

Two properties fall out of this rather than needing rules of their own:

- **Claims are atomic, so two replicas can never hold the same index.** The settle window therefore only affects
  how evenly work is spread — a short one costs balance, never correctness.
- **Coverage is always complete.** An index nobody claimed is picked up by the replica below it, so running fewer
  replicas than intended means somebody works harder, not that a guild stops being watched.

An index owns a _fixed_ slice, so it means the same shards no matter how many peers are up. That is what lets a
replica hold its assignment for its whole lifetime instead of resharding underneath itself whenever the cluster
changes size.

### Changing shards means restarting

`@discordjs/ws` cannot add shards to a live `WebSocketManager` — `updateShardCount` tears everything down and
respawns it. So a replica whose coverage should change logs and exits 0, and Docker restarts it. A watcher does
this when indices go unclaimed, debounced over two checks and acted on only by the replica holding the lowest
index, so one gap causes one restart rather than a cluster-wide bounce.

This is only affordable because restarts RESUME. See below.

### Known wart: stragglers

A replica starting well after its peers' settle window finds everything claimed and idles as a hot spare, leaving
the cluster correct but unbalanced until the next restart. It is logged as a warning. Fixing it live needs
cross-replica negotiation that is not worth it when `./compose` starts replicas together by construction.

## What actually had to change

The `WebSocketManager` options were the small part. These are the things that were silently single-replica:

| Was                                                               | Now                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| No gateway session store — every restart re-IDENTIFYs every shard | Redis-backed, write-behind (`lib/sessions.ts`)                       |
| No graceful shutdown anywhere in the repo                         | `SIGTERM`/`SIGINT` → flush, release, close (`lib/shutdown.ts`)       |
| Guild list overwritten wholesale every 10s                        | One entry per replica, unioned on read (`backend-core/data/bots.ts`) |
| `/deploy` Ready bootstrap raced across processes                  | Redis `SET NX` claim before the emptiness check                      |
| ModMail's four sweeps acted on every guild                        | `ownsShardForGuild` filter, composed with #216's instance scoping    |
| One identify throttler per process                                | Redis-backed, per rate-limit bucket (`lib/identifyThrottler.ts`)     |
| All replicas appending one rotated log file                       | Per-container filename suffix when scaled                            |

This is the same failure class #216 hit with two ModMail deployments sharing one guild-list key
([01-architecture.md §8](01-architecture.md#8-custom-modmail-instances-216)), and the fixes follow that precedent.

### The session store is write-behind, and has to be

`@discordjs/ws` calls `retrieveSessionInfo` and `updateSessionInfo` on **every dispatch event**, to advance the
stored sequence number — not just on Ready. A straight redis-backed implementation would put two round trips in
front of every Discord event the process handles. Memory is therefore the hot path and the authoritative copy
while the process is alive; redis is written every few seconds and on shutdown, and read once per shard at boot.

After an unplanned death the stored sequence can be one flush interval stale, so the RESUME replays a few seconds
of already-handled events. That is normal gateway behaviour handlers must tolerate anyway, and it is strictly
better than not resuming.

### Shutdown does not destroy the gateway, on purpose

`WebSocketManager.destroy` takes `Omit<WebSocketShardDestroyOptions, 'recover'>` — `recover` cannot be passed at
the manager level — so every manager-level destroy hits the `recover !== Resume` branch in `@discordjs/ws` and
calls `updateSessionInfo(shardId, null)`, wiping exactly the sessions that were just flushed. Letting the process
exit with its sockets open instead leaves Discord holding a resumable session. This looks like an omission in
`lib/shutdown.ts` and is not; it is commented there.

## What did **not** need to change

- **`withGuildUserLock` stays process-local.** A guild maps to exactly one shard owned by exactly one replica, so
  every guild-scoped event and interaction for a given guild+user still lands in one process. DMs always arrive on
  shard 0, so ModMail's DM paths are single-replica by construction too. This narrows
  [11-automoderator-port.md](11-automoderator-port.md)'s scaling-readiness item 4, which assumed otherwise.
- **AMA's scheduled-close sweep.** It is a single atomic `UPDATE ... WHERE ended = false ... RETURNING`, so the row
  is the lock and exactly one replica's statement can claim it. Shard-scoping it would buy nothing.
- **`services/discord-proxy`.** Already the answer to cross-process REST rate limiting
  ([01-architecture.md §11](01-architecture.md#11-discord-rest-proxy-servicesdiscord-proxy)); N replicas of a bot
  are just more clients of the same hop.

## Deliberately out of scope

- **Worker threads.** `WorkerShardingStrategy` distributes shards across cores within one process — the _vertical_
  axis, one failure domain, one restart unit. It is a good fit for gateway decode CPU and a poor fit for what this
  document is about. `buildStrategy` is left unset, so adding a `SHARDS_PER_WORKER` knob later is a small,
  additive change. Do it when a profile shows the gateway thread saturated, not before.
- **A container-provisioning `IShardingStrategy`.** Viable — with the strategy handling dispatch itself the manager
  reduces to a provisioner, and it is a control-plane SPOF only, since replicas keep running if it dies. Set aside
  because it needs the docker socket inside a container, a new per-bot service and reconciliation logic, to
  automate an event (Discord's recommendation crossing a 2,500-guild boundary) that fires a few times a year and
  forces a full re-identify anyway.
- **Metrics.** Only `services/api` has a Prometheus registry; bots have none. Diagnosability here is log-based,
  which matches the repo's existing bias. Add gauges (`shards_owned`, `replica_index`) when bots gain a registry —
  AutoModerator's P0 observability work owns that.

## What to watch in the logs

- `claimed replica slot` on boot carries `replicaIndex`, `heldIndices`, `shardIds` and `shardsOwned`. This is the
  first thing to read when asking "who is running what".
- `claimed replica slot, covering for missing replicas` means the cluster is short — one replica is carrying more
  than its target. Coverage is fine; capacity is not.
- `no free replica index, idling as a hot spare` means more replicas are running than the shard count needs, or a
  straggler missed its settle window.
- `lost replica lease, restarting to re-derive shard assignment` means a renewal found somebody else holding the
  index. Rare and self-healing, but a repeated one means redis latency is eating the lease TTL.
- `replica indices still unclaimed, restarting to take them over` means a peer died or was scaled away.

## Verification

Agent side: `yarn build`, `yarn lint`, `yarn test`, `yarn format:check`, all green. Unit tests cover the pure
assignment logic (`computeTotalIndices`, `shardIdsForIndices`), concurrent claiming, complete coverage when
fully and under-provisioned, the hot-spare takeover, the guild-list union with a stale replica, and the session
store's write-behind semantics.

Operator side, per [workflow.md](../workflow.md#verification-standard) — see the runbook there for the procedure:

- A scaled bot receives events for every guild, with no duplicate handling.
- Dashboard bot badges stay correct across a replica bounce.
- `./compose up` scales to the expected replica count against the live `/gateway/bot`.
- A rolling restart resumes rather than re-identifying, and does not exhaust the identify budget.
