# Horizontal scaling for bots (`@chatsift/bot-core`)

**Depends on:** nothing. **Unblocks:** [11-automoderator-port.md](11-automoderator-port.md) P8, which was written
against a mechanism that did not exist yet. **Live production impact:** scaling is off by default — no bot runs
more than one replica until a `<BOT>_SHARDS_PER_REPLICA` value is set. It is _not_ a no-op change, though: every
bot now stores gateway sessions in redis, claims a replica slot at boot, throttles identifies through redis, and
handles `SIGTERM`. That shared path is deliberate (see below) and is what needs watching on the deploy that ships
it, rather than anything gated behind the env var.

## Status: implemented

## What this is

Every bot can now run as N identical replicas, each owning a slice of the gateway shards. Which slice is decided
at boot against redis, not configured per container.

The design goal that shaped everything else: **scaling out is a configuration change, and the scaled code path is
the one dev runs every day.** There is deliberately no `if (shards === 1)` branch anywhere. With
`SHARDS_PER_REPLICA` unset a bot claims a single index covering every shard — the same gateway topology it had
before — but it reaches that through the same claim, the same redis keys, the same identify throttler and the same
session store a 16-shard deployment uses. The observable Discord behaviour is unchanged; the machinery underneath
it is not, and that is the point. A scaling path that only executes in production is a scaling path nobody has
tested.

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

**Indices and shard ids are different number spaces**, and they collide confusingly at the low end — index `0`
entitles its holder to shards `0-3`. Only _indices_ are ever leased in redis; shard ids are derived from them
locally, by arithmetic. For a 14-shard bot there are four redis keys, not fourteen.

```
shardCount=14, SHARDS_PER_REPLICA=4  ->  totalIndices=4

redis key           what holding it means
shardlease:<bot>:0  -> run shards 0,1,2,3
shardlease:<bot>:1  -> run shards 4,5,6,7
shardlease:<bot>:2  -> run shards 8,9,10,11
shardlease:<bot>:3  -> run shards 12,13

4 replicas:  one index each                          -> 4 / 4 / 4 / 2 shards
3 replicas:  the third holds indices 2 AND 3         -> 4 / 4 / 6 shards
5 replicas:  the surplus finds nothing free and waits as a hot spare
```

A slice belongs to an _index_; a replica owns the union of the indices it holds. Those are the same thing only
when the cluster is at its intended size.

Two properties fall out of this rather than needing rules of their own:

- **Claims are atomic, so two replicas can never hold the same index.** The settle window is therefore never a
  correctness concern, however the timing falls. This one holds at every instant.
- **Coverage converges.** An index nobody claimed gets picked up by the replica below it, so running fewer
  replicas than intended costs effort rather than coverage — but that is the _settled_ state, not a continuous
  guarantee. A replica that dies takes its shards down until something reclaims its index, so **transient dark
  shards are possible and expected**:

  | How the index came free                  | Dark for                                                                                         |
  | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
  | Crash or planned restart                 | that container's restart, typically seconds — it reclaims its own index                          |
  | Removed for good (scale-down, host gone) | up to the lease TTL, plus two watcher checks, plus the neighbour's restart — on the order of 90s |

  Nothing shortens the second case without giving up the debounce that stops a peer merely between renewals from
  bouncing the cluster. If a bot ever needs sub-minute recovery from a permanently removed replica, that is a
  reason to revisit the watcher interval, not the assignment scheme.

An index owns a slice that is the same shards no matter how many peers are up. That is what lets a replica hold
its assignment for its whole lifetime instead of resharding underneath itself whenever the cluster changes size.

### On balance

Slices are flat — index `i` owns `[i * SHARDS_PER_REPLICA, (i + 1) * SHARDS_PER_REPLICA)` — rather than dividing
the shard count proportionally across indices. Proportional slicing would balance the tail better (`3/4/3/4`
instead of `4/4/4/2` for 14 shards) and was rejected anyway, because it trades the wrong thing:

- **An index must mean the same shards regardless of the current shard count.** Flat slices survive Discord
  raising its recommendation: 14 → 15 grows only the tail replica. Proportional boundaries move on almost any
  bump, so every replica reshards, every replica restarts, and every replica's guilds change.
- **`SHARDS_PER_REPLICA` stays a shard count**, not a divisor — index `i` means the same slice whatever the
  cluster is doing, which is what makes the previous point true.

So a short tail is **headroom, not imbalance** — `4/4/4/2` fills to `4/4/4/3`, `4/4/4/4`, and then a fifth index
appears.

Genuine imbalance has exactly two causes, and both are the cluster not being at its intended size:

- **A replica is missing.** A peer covers its indices. This is unavoidable rather than a design choice: if three
  replicas must cover four indices' worth of shards, one of them holds more. The alternative is leaving those
  shards uncovered for as long as the replica stays away, which is the trade this design refuses.
- **A straggler.** A replica starting after its peers' settle window finds everything claimed and idles as a hot
  spare while some peer holds two indices — until that peer notices it and hands one back, see
  [Handing an index back](#handing-an-index-back).

Perfect balance under a changing replica count would mean re-slicing `shardCount` across however many replicas are
currently live — which makes every replica's assignment depend on every other's liveness, so one replica
appearing or disappearing reshards (and therefore restarts) the entire cluster, and two replicas disagreeing for
even a moment about the live count produces overlapping or missing shards. That is a materially worse failure mode
than one replica temporarily carrying an extra index.

### Sizing a container

`SHARDS_PER_REPLICA` is the **steady-state target, not a hard cap**, so it is not the only input to sizing. A
replica holds the union of every index it claims, and it claims extras precisely when peers are missing — which is
also when the surviving replicas are carrying the most load:

| Cluster state                  | Shards on the heaviest replica                                          |
| ------------------------------ | ----------------------------------------------------------------------- |
| Fully provisioned              | `SHARDS_PER_REPLICA`                                                    |
| One peer missing               | `2 × SHARDS_PER_REPLICA`, until the peer returns and is handed one back |
| Worst case (only one survivor) | the entire `shardCount`                                                 |

Size for at least **twice** `SHARDS_PER_REPLICA` if a single replica loss should be absorbed without degrading,
and treat `shardsOwned` in the boot log (and the `covering for missing replicas` message) as the signal that a
replica is running above its target.

### Changing shards means restarting

`@discordjs/ws` cannot add shards to a live `WebSocketManager` — `updateShardCount` tears everything down and
respawns it. So a replica whose coverage should change logs and exits 0, and Docker restarts it. A watcher does
this when indices go unclaimed, debounced over two checks so a peer that is merely between renewals (or one
Docker is already restarting) doesn't trigger it.

**Which replica reacts matters, and is not the obvious one.** Re-derivation claims the lowest free index and then
extends upward, stopping at the first index a live peer holds — so a replica can never jump over a living peer.
The replica that can close a gap is therefore the one whose run ends immediately below it, not the lowest holder
in the cluster. With `A[0] B[1] C[2] D[3]` and `C` gone, `A` restarting would reclaim index 0, stop dead at live
`B`, and leave index 2 exactly as unclaimed as it found it — then repeat every interval, bouncing its own shards
forever while index 2 stayed dark. `B` is the only replica whose re-derivation reaches index 2. A gap at index 0
is the one case with nothing below it, so the lowest holder takes that one.

This is only affordable because restarts RESUME. See below.

### Handing an index back

A replica that finds every index claimed idles as a **hot spare**, advertising itself in a redis sorted set
(`shardspares:<botId>`, scored by when it last checked in). That advertisement is what lets the cluster recover
its balance, and it exists because without it recovery simply never happened:

> Four replicas, `C` dies. `B` is elected, restarts, and comes back holding indices 1 _and_ 2 — correct, and
> carrying double load. `C`'s container then recovers, finds all four indices claimed, and idles forever. There is
> no gap any more, so the watcher never fires. `B` runs 2× load next to an idle container until the next
> `./compose up`. Restarting `B` doesn't help either: `B` and the spare just race for the freed indices and swap
> roles.

So every transient replica loss used to cost balance permanently. The handoff closes that with two rules:

1. **An elected covering replica sheds when a spare is waiting.** The watcher, on finding no gaps, works out
   which replicas are covering (from the lease owners) and elects the lowest-primary ones, **capped at the number
   of spares actually waiting**. Shedding means restarting, and a restart releases _every_ index that replica
   holds — so letting all covering replicas react to one spare would black out far more than that spare can take
   back, and every restart past the first would be churn. Debounced over two checks, like the gap branch.
2. **A replica stands down from greedy claiming while a spare is advertising.** This is the half that makes it
   stick: without it the shedding replica would grab its extra index straight back on the way up, swapping roles
   with the spare instead of rebalancing.

Suppressing the greedy step is deliberately all the negotiation there is — no replica tells another what to take.
Whoever is left claims what the other declined, on its next poll. If the spare dies mid-handoff its advertisement
goes stale, the next boot covers as before, and a gap (if any) falls back to the watcher.

**It converges, but not always in one step.** The rule is "the shedder drops to its primary, the spare takes the
rest", which is exact when one peer died and returned (`B[1,2]` → `B[1] S[2]`) and coarser the more a single
replica had absorbed:

| Before                          | One spare returns  | Split                       |
| ------------------------------- | ------------------ | --------------------------- |
| `A[0]  B[1,2]`                  | `A[0] B[1] S[2]`   | even                        |
| `A[0]  B[1,2,3]`                | `A[0] B[1] S[2,3]` | even for three replicas     |
| `A[0,1,2,3]` (only one running) | `A[0] S[1,2,3]`    | 1/3 — `2/2` would be better |

Each returning replica pulls the largest holder down to one index and takes what it drops, so `1/3` becomes
`1/1/2` and then `1/1/1/1` as the rest come back. No step is ever worse than the state before it, coverage stays
complete throughout, and the fully-staffed end state is one index each. Landing evenly in a _single_ step would
mean a replica knowing how many peers are live and how many indices each holds — the cross-replica bookkeeping
this design avoids everywhere else.

The remaining rough edge is a **straggler**: a replica starting well after its peers' settle window still idles
rather than triggering an immediate rebalance — it only gets an index once a covering peer notices it. That is one
watcher interval, not "until the next deploy".

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

### The guild-list slice is per replica, but READY is per shard

A replica's slice (`guilds:<botId>:<replicaIndex>`) covers every shard that replica runs, and `Ready` fires once
per shard. Clearing the slice on READY — which is what the original implementation did — therefore had the second
shard to identify erase every guild the first had already announced via `GUILD_CREATE`. Nothing re-announces a
guild after that, so those guilds simply stopped existing as far as the dashboard was concerned until the next
cold boot, which lost a different arbitrary slice. It was found in production on public ModMail, running two
shards on one replica: roughly the guilds delivered in the five seconds between shard 0's READY and shard 1's.

`syncShardGuildList` reconciles against READY's own `guilds` payload instead — that payload is already the
authoritative list for the shard, so the slice never has to pass through empty, and each shard only clears
members it speaks for. That predicate also has to claim guilds this replica has _no_ shard for: Discord raising
its shard count remaps every guild, and a member stranded by that would otherwise be kept alive by the heartbeat
forever with no shard willing to clear it.

The narrower version of the same bug was there on single-shard bots too — the `del` and the GUILD_CREATE sweep it
was clearing for were both in flight at once, so a guild whose event landed between them was lost. Announcing the
payload up front removes the window rather than shrinking it.

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
  straggler missed its settle window. Paired with `a hot spare is waiting...restarting to hand them over` on a
  covering peer, that is the rebalance working; on its own for more than a watcher interval, nobody was covering.
- `hot spare took over a freed replica index` closes that loop -- the spare is no longer idle.
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
