# AutoModerator port (monolith rebuild, feature-by-feature)

**Tracking issue:** to be created — this doc is referenced from it, not the other way around. **Depends on:** nothing
in flight. **Blocks:** the `postgres-old` teardown — AutoModerator is the last product still on the legacy stack, so
its cutover (P9) is what finally lets the old database, its compose stack and its Caddy routing die. **Live
production impact:** none until P9. Everything before that is additive: new tables, a new service, new routes, new
dashboard pages. Legacy AutoModerator (`origin/v2`, deployed from `ChatSift/stack`) keeps running untouched the whole
time.

## Status: P0 done, P1 next

Scope is settled (36 features surveyed, 26 in, 10 out — see [Scope](#scope)). Phasing below is per-feature vertical
slices, not layer-by-layer: each phase carries its own schema, API, bot and dashboard work so nothing sits half-built
across the stack.

P0 landed 2026-08-13 and is verified end to end against the test guild — see its section for what shipped and the
two deviations. **The AutoMod spike passed**, so feature 01's design and P5's scope are settled on evidence rather
than assumption; see [The AutoMod hybrid](#the-automod-hybrid).

## Owner decisions already made

Recorded so they don't get re-litigated.

1. **Monolith, not microservices.** Legacy's seven services (`gateway`, `discord-proxy`, `interactions`, `automod`,
   `mod-observer`, `logging`, `scheduler`) collapse into one `services/*-bot` process on `@chatsift/bot-core`, exactly
   like AMA, ModMail and Social. The split is what created the need for a broker in the first place. The one
   exception is `discord-proxy`, which came back as a stack-wide `services/discord-proxy` for a reason legacy
   didn't have — a bot's token being used from both its bot process and `services/api` — but it's shared
   infrastructure this port consumes, not a per-bot service. See
   [01-architecture.md §11](01-architecture.md#11-discord-rest-proxy-servicesdiscord-proxy).
2. **AMQP is gone. Redis is the only broker.** See [Brokerage](#brokerage-what-actually-needs-a-broker) — most of
   legacy's three AMQP exchanges become in-process function calls, and what genuinely remains cross-process already
   has a mechanism in `backend-core`.
3. **Per-feature phasing.** Foundations first (schema baseline, API surface, dashboard scaffold, observability,
   dev affordances), then one feature at a time through the full stack.
4. **First bot to opt into bot-core horizontal scaling.** The mechanism now exists
   ([12-horizontal-scaling.md](12-horizontal-scaling.md)) and opting in is configuration, as intended. This doc's
   job is still to ensure AutoModerator is _shaped_ for it. See [Scaling readiness](#scaling-readiness).
5. **The invite worker is dropped.** `invite-lookup.chatsift.workers.dev` is live but its source isn't in this repo
   and nothing on `main` calls it. Invite resolution happens through the bot's own REST client instead.
6. **Banword matching is delegated to Discord.** Feature 01 ships no matcher — see
   [The AutoMod hybrid](#the-automod-hybrid).
7. **Cases migrate for real.** Like Social's XP, case history is accumulated state; it cannot drain. P9 is a
   script + `--verify` + freeze window, following the Social precedent.

## Scope

The full 36-feature survey (what each feature was, when it shipped, what Discord has since absorbed, and the
per-feature port decision) lives outside this doc. The decision totals:

- **26 ported** — 23 substantially as-was, 3 reshaped (01 banwords, 09 filter exemptions, 33 filter log).
- **10 dropped** — 04 global malicious-URL filter, 05 file-hash filter (already deleted in 2022), 06 NSFW
  inference, 08 mention limit/rate, 14 blank-avatar kick, 15 forbidden names, 16 mute-role reapplication, 21
  role-mute machinery, 25 raid cleanup, 36 self-assignable roles.

Four consequences of the drops, accepted knowingly:

- **Mutes cap at four weeks.** Native timeouts only. Anything longer is a tempban or nothing.
- **The `name` banword flag disappears** with feature 15 — the one part of 01's flag model that doesn't survive.
- **No criteria-driven raid response.** Avatar-hash selection goes with feature 25; the fallback is Discord's
  security actions plus members-page multi-select.
- **Self-assignable role data does not migrate.** `self_assignable_roles*` is dropped at P9, not ported.

## New-stack mapping

| Legacy (`origin/v2`)                            | New                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 7 services + AMQP fanout                        | one `services/automoderator-bot` process                                                           |
| `services/gateway` (custom gateway)             | `createBotGateway` from `@chatsift/bot-core`                                                       |
| `services/discord-proxy` (shared REST cache)    | `services/discord-proxy` — rate limiting only; the route cache is dropped                          |
| `services/interactions` (+ its own HTTP server) | `registerCommandHandlers` / `registerUnknownCommandResolver`                                       |
| `services/automod` runner pipeline              | in-process filter pipeline, same transform → check → run → cleanup → log shape                     |
| `services/mod-observer`                         | in-process gateway listeners                                                                       |
| `services/logging` (AMQP consumer → webhooks)   | in-process log dispatcher, same webhook-token storage                                              |
| `services/scheduler` (10s poll)                 | in-process scheduler, `FOR UPDATE SKIP LOCKED` claim (see [Scaling readiness](#scaling-readiness)) |
| Prisma + `prisma/schema.prisma`                 | `packages/private/db/schema/schema.sql` + Atlas migration + kanel regen                            |
| `tsyringe` DI container                         | `initContext`/`getContext` from `@chatsift/backend-core`                                           |
| `cordis` brokers / bitfields / util             | `@discordjs/core`, plain TS                                                                        |
| Cloudflare invite-lookup worker                 | `rest.get(Routes.invite(code))` on the bot's own token                                             |
| Own banword matcher                             | Discord AutoMod keyword rules + `AUTO_MODERATION_ACTION_EXECUTION`                                 |
| `apps`/`sigs` app-auth model                    | existing dashboard-grant + `isAuthed` machinery                                                    |
| Separate `chatsift/dashboard`                   | `apps/website` under a new product tab                                                             |

### Naming — decide before P0

The service, the `BotId`, the env var and the `bot:<BotId>` Redis key all bake in at P0 and are expensive to change
after. The collision worth avoiding: **our filter subsystem and Discord's AutoMod are different things**, and feature
01 makes them talk to each other constantly.

Recommendation: service `services/automoderator-bot`, `BotId` `'AUTOMODERATOR'`, env `AUTOMODERATOR_BOT_TOKEN`.
Longer than the `ama`/`modmail`/`social` precedent, but it keeps "AutoModerator" (the product) and "AutoMod"
(Discord's feature) textually distinct everywhere — including in log lines and metric labels, where the ambiguity
would otherwise be permanent. The rest of this doc assumes it.

## The AutoMod hybrid

Feature 01 is the one genuinely novel piece of architecture in the port, and two other features hang off it, so it's
specified here rather than buried in a phase.

Discord's AutoMod does the matching: 6 keyword rules per guild, 1,000 entries each, 10 regex patterns per rule, allow
lists, per-rule role and channel exemptions. What it cannot do is respond with anything but block / alert / timeout /
quarantine. AutoModerator supplies the response layer.

**Mechanism.** Subscribe to `AUTO_MODERATION_ACTION_EXECUTION` (needs the `AutoModerationExecution` gateway intent).
The payload carries `rule_id`, `matched_keyword` and `matched_content`.

**Keying.** Policy rows key on `matched_keyword`, not `rule_id` — that preserves legacy's per-word flag model
(`warn`/`mute`/`kick`/`ban`/`report` + a per-entry mute duration). Keying on the rule would coarsen policy to
per-rule and lose the feature. `banned_words` therefore ports nearly unchanged, minus the columns that existed only
to drive matching.

**What this obliges.** Three things that need saying out loud because they're new coupling:

- The bot no longer controls whether a message is deleted — Discord already blocked it before the event arrives.
  Feature 30 ("report instead of delete") becomes "report, and configure that rule to alert rather than block". The
  policy survives; the suppression point moves into Discord's rule config, which means **the dashboard has to be able
  to read and write AutoMod rules**, not just our own table.
- A guild with no keyword rules configured gets no events, and therefore no banword enforcement. The dashboard needs
  to surface that state honestly rather than showing an empty-but-healthy filter page.
- This was the single riskiest assumption in the plan. **P0's spike proved it** (2026-08-13): a native keyword
  rule blocking `ball` produced an `AUTO_MODERATION_ACTION_EXECUTION` carrying `matched_keyword: "ball"` and the
  offending `user_id`, with the message already suppressed by Discord. Policy can key on the keyword as designed.

## Brokerage: what actually needs a broker

Legacy ran three AMQP exchanges. Auditing them against a monolith:

| Legacy exchange             | Carried                                | In the monolith                  |
| --------------------------- | -------------------------------------- | -------------------------------- |
| `gateway` (routing)         | Discord events → automod, mod-observer | in-process listener registration |
| `guild_logs` (pubsub)       | log payloads → logging service         | in-process function call         |
| gateway broadcasts (pubsub) | `REQUEST_GUILD_MEMBERS` from commands  | dropped with feature 25          |

So the broker disappears with the split that created it. Redis's actual roles here:

1. **Caches** — the message cache that makes edit/delete logging possible (feature 34), and the anti-spam sorted
   sets (feature 07). Same semantics as legacy; keys documented in code.
2. **Dashboard realtime invalidation** — already exists and is reused verbatim: `publishRealtimeInvalidate` in
   `backend-core/src/lib/realtimeBroadcast.ts` over the `ws:invalidate` channel, consumed by the API's WS gateway.
   Every mutating route declares `realtimeChannel` and gets it for free.
3. **The guild list** — `bot:AUTOMODERATOR`, same as every other bot.
4. **Distributed locks** — still not needed at P8, in most places. `withGuildUserLock` is process-local, which
   stays correct under sharding because a guild's events only ever reach one replica. See
   [Scaling readiness](#scaling-readiness) item 4 for the narrow set that genuinely needs a Redis lock.

**No queue library.** The scheduler stays a polled task table, as it was in legacy. BullMQ or similar would be a new
dependency buying a retry/backoff/delay model the `tasks` table already implements in ~40 lines, and would put job
state somewhere other than the database the rest of the product's state lives in.

## Cross-cutting foundations

These land in P0 and every subsequent phase is expected to use them. They are the difference between "26 features
ported" and "26 features that can be operated".

### Observability

Reuses the API's shape from #277 (`services/api/src/core/metrics.ts`): a dedicated `prom-client` `Registry`, not the
process-wide default, so the scrape output stays exactly what was asked for.

**Collection is always on; exposure is gated.** Instrumentation compiles in and records unconditionally, in dev as
well as prod — a mislabelled or never-incremented metric that only runs in production is a bug you find in
production. What `ENV.IS_PRODUCTION` gates is _binding the HTTP endpoint_. This is a deliberate reading of "data
collection in place when `IS_PRODUCTION` is true": the counters are cheap in-memory adds, and having dev exercise the
same code path is worth more than the microseconds.

**Endpoint.** A minimal HTTP listener on the bot serving `/metrics`, guarded by the same Bearer-token
`requireMetricsSecret` approach the API uses (`METRICS_SECRET`, read by Prometheus from
`build/prometheus/metrics_secret`). Adding the scrape job is six lines in `build/prometheus/prometheus.yml` when
wanted — deliberately **not** part of any phase here, per the owner's call.

**Metric taxonomy.** Feature-level, which is the point — "is feature N working in prod" should be answerable without
reading logs.

```
automoderator_feature_invocations_total{feature, outcome}     counter  outcome: applied|skipped|dry_run|failed
automoderator_feature_duration_seconds{feature}               histogram
automoderator_moderation_actions_total{action, source, dry_run} counter action: warn|mute|kick|ban|unban|delete
                                                                        source: command|automod|ladder|report|scheduler|observer
automoderator_cases_created_total{action, source}             counter
automoderator_filter_hits_total{filter}                       counter  filter: words|urls|invites|antispam
automoderator_automod_events_total{action_type, matched}      counter  native AUTO_MODERATION_ACTION_EXECUTION intake
automoderator_scheduler_tasks_total{type, result}             counter
automoderator_scheduler_lag_seconds{type}                     histogram  run_at → actually ran
automoderator_reports_total{state}                            counter  filed|dismissed|actioned
automoderator_log_dispatch_total{log_type, result}            counter  webhook delivery health
automoderator_discord_errors_total{status, route_class}       counter
automoderator_dry_run_suppressions_total{action}              counter
```

**Cardinality discipline, non-negotiable:** never label by `guild_id`, `user_id`, `channel_id`, `message_id` or
matched content. Every label above is drawn from a closed set known at compile time. This is the same rule the API's
metrics module already states about route patterns versus resolved URLs, and it's the one mistake that turns a
metrics endpoint into an outage.

### Dry-run

Every side-effecting Discord call — ban, kick, timeout, role change, message delete, DM, webhook post — goes through
a single `ActionExecutor` seam. **Nothing else calls REST for a side effect.** That single chokepoint is what makes
dry-run one flag rather than a hundred conditionals, and it's cheap only if it's established in P0, before there are
call sites to retrofit.

**Modes:**

- `live` — normal.
- `dry-run` — Discord side effects suppressed; **database writes still happen**, with cases marked `dry_run = true`.
  The bot replies with exactly what it would have done: target, action, duration, reason, and which rule or ladder
  step decided it.

Persisting in dry-run is the non-obvious call, and it's deliberate: escalation ladders (11, 22) are stateful, so a
dry-run that persists nothing can't exercise the thing most likely to be wrong. The `dry_run` flag keeps those rows
filterable, and **ladder counting ignores them in `live` mode** so a dev session can't push a real user up a rung.

**Dry-run is a development affordance, not an operational mode.** `resolveDryRun` short-circuits to `live` whenever
`IS_PRODUCTION`, before consulting anything else — so a production guild can neither be put into dry-run nor left
stuck in it. Outside production the precedence is guild → invocation:

- **Guild** — `automoderator_guild_settings.dry_run`, `NOT NULL DEFAULT true`. A guild nobody has configured is in
  dry-run, because that's the reading that can't ban someone in a real guild from a dev session.
- **Invocation** — a command explicitly asking to preview what it would do. Can only ever turn dry-run _on_, so
  nothing reachable from inside an interaction escapes the guild's setting.

There is deliberately **no deployment-wide env var**. It would only ever read one way in production, which makes it a
switch that lies — and "why did nothing happen" traced back to a stale env var is a worse failure than not having the
knob. The consequence to accept: there is no way to put production as a whole into observe-only mode. Per-feature
experiment gating (below) is the production kill switch, and it's the better-shaped one, since it can be flipped for
a single guild without a deploy.

`automoderator_dry_run_suppressions_total` should therefore be flat at zero in production by construction, not by
convention — a non-zero value there means `resolveDryRun`'s short-circuit has been broken.

### Feature gating

The `experiments` / `experiment_overrides` tables already exist in `schema/schema.sql` — `name` + `range_start` /
`range_end` for a guild-hash bucket rollout, plus per-guild overrides. They have generated kanel types and **no
runtime consumers**: dormant infrastructure, not a new dependency.

Reviving them is exactly what per-feature phasing wants. Each feature ships behind a named experiment, enabled for
the test guild by override, then widened by range. It also gives an operator a per-guild kill switch that doesn't
need a deploy — which matters more here than in any other product, because a misfiring filter bans people.

P0 builds the read helper and the override admin path. If a phase's feature has no sensible gate, say so in that
phase rather than skipping it silently.

### Dev and test affordances

Beyond dry-run, in rough order of how much time each saves:

1. **`/simulate <message>`** — push a synthetic message through the whole filter pipeline and get back which runners
   fired, which entries matched, which exemptions applied, and what would have happened. Tunes filters without
   spamming a channel, and is the single highest-value affordance in this list.
2. **Decision traces.** Every automod decision emits one structured log line carrying the full reason chain: runner,
   matched entry, exemption checked, bypass evaluated, ladder position, action taken or suppressed. Legacy logged
   outcomes; the gap was always _why_ something didn't fire.
3. **Seeded guild fixtures.** One script that fills a guild's config — banwords, allowlists, ladders, log channels —
   so a fresh dev database is usable immediately. Seed it with some deliberately dangling channel/role IDs: that's
   the bug class the dashboard selects have hit repeatedly.
4. **Injected clock.** The scheduler, ladder decay and auto-pardon are all time-driven; a `now()` provider makes
   them unit-testable without sleeping.
5. **Idempotency keys on case creation.** Gateway redelivery after a reconnect is normal, and legacy's 30-second
   audit-log correlation window (feature 27) is exactly the shape of code that double-fires. Required for P8
   regardless.
6. **`/whyami`-style introspection** — given a member, print which bypass roles, exemptions and gates currently apply
   to them. Answers "why didn't the filter catch that" in one command.

## Phases

Additive throughout; nothing touches legacy until P9. Each phase ends verified per
[workflow.md](../workflow.md#verification-standard) — build/lint/test green **and** the change exercised against the
test guild. Each phase lists its slice across all four layers; "—" means that layer has no work.

---

### P0 — Foundations

No user-facing features. Everything here is what P1+ builds on.

| Layer     | Work                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_guild_settings` baseline; `experiments` helper usage; nothing feature-specific yet                   |
| API       | mount point + one `GET /v3/guilds/:guildId/automoderator/config` proving the contract, `isAuthed`, realtime channel |
| Bot       | `services/automoderator-bot` scaffold: `bin.ts`, context init, `createBotClient`, `/deploy`, `/dashboard`           |
| Dashboard | product tab + guild shell page, empty config form wired to the one route                                            |

Plus the cross-cutting foundations: `ActionExecutor` seam, metrics registry + gated `/metrics` listener, experiment
read helper, decision-trace logger, seed script.

**And the AutoMod spike.** Register a keyword rule via the API, trip it, confirm `AUTO_MODERATION_ACTION_EXECUTION`
arrives with usable `matched_keyword`, and confirm the bot can read and write the guild's rules. If this doesn't
behave as documented, feature 01's design changes and P5 gets rescoped — which is why it happens in P0 and not in P5.

Infra edits that come with a new service, following Social's precedent: `AUTOMODERATOR_BOT_TOKEN` in
`backend-core`'s `env.ts`, `'AUTOMODERATOR'` added to `BOTS` in `@chatsift/core`, `Dockerfile`, `docker-compose.yml`,
dev scripts.

**Shipped 2026-08-13.** Two deviations from the table above, both deliberate:

- **`PATCH` as well as `GET` on the config route.** "One route proving the contract" and "a config form" are
  incompatible if the form can't save.
- **No seed script.** At P0 there is one boolean to seed, so it lands at P1 with cases and log channels instead.
  The dangling-channel/role-id seeding it exists for has nothing to point at yet.

The experiment read helper is `@chatsift/backend-core`'s `experiments.ts` (snapshot + 60s refresh, modelled on
`instances.ts`; buckets are basis points, salted per experiment name so each rollout picks a different slice), and
the override admin path is `GET`/`PUT`/`DELETE /v3/experiments[/:name]` — global-admin only, declarative override
sets, no dashboard page. **P0 itself gates nothing**: there is no feature to switch off yet, and the first real gate
is P1's.

Verified against the test guild: `/deploy` registers all three commands, the spike round trip works (see
[The AutoMod hybrid](#the-automod-hybrid)), the dashboard tab/hub/config page render and persist, and `/metrics`
is correctly unbound outside production.

Deployment prerequisite: `AUTOMODERATOR_BOT_TOKEN` is a required var read by `services/api` as well as the bot,
so it must exist in `.env.private` before _any_ service boots — the shape of the 2026-08-11 incident the
`build/grafana/provisioning/alerting/rules.yml` comment records.

---

### P1 — Case spine

The highest-value cluster and the one everything else attaches to. Features **18** (cases), **17** (mod commands),
**28** (permissions), **31** (log channels), **32** (mod-action log), **19** (history), **27** (manual-action
observation).

| Layer     | Work                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_cases`, `automoderator_log_webhooks`; case numbering per guild                                 |
| API       | case list/detail/patch, history-by-user, log-channel config                                                   |
| Bot       | `CaseManager`; `/warn` `/mute` `/unmute` `/kick` `/ban` `/unban` `/softban` `/case` `/history` + History menu |
| Dashboard | case browser with filters, case detail, log-channel config                                                    |

Notes:

- `/softban` ships despite being redundant against the native ban dialog — owner's call, parity wins.
- Permission tiers: legacy collapsed `mod` and `admin` to the same check. **Don't carry that forward** — decide the
  real tiers here, while there's exactly one consumer.
- Feature 27's audit-log correlation is where idempotency keys earn their place.
- Mutes are timeouts only, four-week ceiling. No mute role, no `unmute_roles` snapshot.

---

### P2 — Scheduler and ladders

Features **20** (timed actions), **22** (warn ladder), **23** (auto-pardon).

| Layer     | Work                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| Schema    | `automoderator_tasks`, `automoderator_warn_punishments`, `auto_pardon_warns_after` setting |
| API       | ladder CRUD, auto-pardon config                                                            |
| Bot       | scheduler loop with `SKIP LOCKED` claim; tempban expiry; ladder evaluation on warn         |
| Dashboard | ladder editor, auto-pardon setting                                                         |

The scheduler claims with `FOR UPDATE SKIP LOCKED` from day one rather than assuming one replica — see
[Scaling readiness](#scaling-readiness). Metrics: `scheduler_lag_seconds` is the one to alert on later.

---

### P3 — Reports

Features **29** (report queue), **30** (filter-driven reports, hook point only).

| Layer     | Work                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Schema    | `automoderator_reports`, `automoderator_reporters`, `automoderator_report_presets`                     |
| API       | preset CRUD; report list/detail for the dashboard                                                      |
| Bot       | both context menus, report card with dismiss/restore/view-reporters/action, action → modal → real case |
| Dashboard | preset config; read-only report queue view                                                             |

Feature 30's automod trigger lands in P5; P3 builds the entry point and proves it with a manual report.

---

### P4 — Logging

Features **34** (message and profile logs), **35** (log exemptions).

| Layer     | Work                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_log_exemptions`                                                                    |
| API       | exemption CRUD                                                                                    |
| Bot       | Redis message cache; edit/delete/nickname/username log dispatch; audit-log attribution on deletes |
| Dashboard | exemption picker                                                                                  |

The message cache is the load-bearing part — without it there is no "what did the deleted message say", which is the
whole feature. Size and TTL it deliberately and put both in config.

---

### P5 — Filters

The largest phase; consider splitting at the horizontal rule if it runs long. Features **01** (banword policy on
native hits), **33** (unified filter log), **11** (trigger ladder + decay), **09** (exemptions), **10** (bypass
roles), **12** (DM on trigger), then **07** (anti-spam), **02** (URL allowlist), **03** (invite allowlist).

| Layer     | Work                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_banword_policies`, `automoderator_allowed_urls`, `automoderator_allowed_invites`, exemption bitfield, `automoderator_trigger_counts` |
| API       | policy CRUD, allowlist CRUD, ladder config, bypass roles, **AutoMod rule read/write proxy**                                                         |
| Bot       | `AUTO_MODERATION_ACTION_EXECUTION` consumer; filter pipeline (urls, invites, antispam); ladder; `/simulate`                                         |
| Dashboard | banword policy editor over native rules, allowlists, ladder editor, bypass roles, filter log config                                                 |

Notes:

- Exemption bitfield shrinks to `urls | invites | antispam`. `words` moves to native per-rule exemptions; `files` and
  `global` are gone with features 05 and 04.
- Feature 33 renders **both** native AutoMod hits and our own runner hits into one filter log, so staff read one
  place. That's the reshape.
- Invite resolution uses the bot's REST client, allowlisting by resolved guild ID (not code), preserving legacy's
  2021 fix against vanity URLs.
- `tlds.txt` comes across with feature 02 and is a standing maintenance item — write that down where someone will
  see it, not just here.

---

### P6 — Remaining utilities

Features **24** (filtered purge), **13** (minimum account age), **26** (invite lookup).

| Layer     | Work                                                       |
| --------- | ---------------------------------------------------------- |
| Schema    | `min_join_age` setting                                     |
| API       | join-age config                                            |
| Bot       | `/purge` with all filters; join-age kick; `/lookup-invite` |
| Dashboard | join-age setting                                           |

Decide whether the join-age kick files a case. Legacy kicked silently, which makes "why did that member vanish"
unanswerable — recommend it does.

---

### P7 — Hardening

No new features. Backfill: unit-test coverage on the pure logic (ladder arithmetic, exemption resolution, purge
filtering, keyword→policy mapping), decision-trace review, metric review against a real week of dev traffic, load
sanity on the message cache, and a pass over every `ActionExecutor` call site confirming nothing bypasses it.

---

### P8 — Horizontal scaling opt-in

**No longer blocked** — the mechanism shipped, see [12-horizontal-scaling.md](12-horizontal-scaling.md). This
phase is now genuinely just configuration, provided the invariants below were held from P0:

- Add `AUTOMODERATOR_SHARDS_PER_REPLICA` to `.env.public` and map it onto the service's `SHARDS_PER_REPLICA` in
  `docker-compose.yml`, following the three existing bot blocks.
- Add a `plan_scale automoderator-bot AUTOMODERATOR_BOT_TOKEN AUTOMODERATOR_SHARDS_PER_REPLICA` line to `./compose`.
- Audit every DB-driven timer this port adds for `ownsShardForGuild`. The scheduler does not need it (`SKIP LOCKED`
  already claims), but anything that reads rows and then acts on Discord does.

The bot itself needs no code change to opt in: `createBotGateway` claims a slot on every boot regardless.

---

### P9 — Migration and cutover

Legacy data migration + drain. Follows the Social precedent
([10-social-port.md](10-social-port.md) while it still exists, then `01-architecture.md`):

- **Reuse the legacy application's token** so no guild has to re-invite — and clear its existing global commands with
  a bulk `PUT []` first, or `bot-core`'s Ready-time `/deploy` bootstrap never fires and no commands register. This
  trap cost Social nothing only because it was caught in advance.
- **Run the migration inside the running `api` container**, not from a host checkout — same image, so it has the
  compiled script and inherits prod `IS_PRODUCTION` / `DATABASE_URL_PROD`.
- Migrate: cases (with their numbering intact), banned-word policies, allowlists, ladders, log-channel webhooks,
  settings. **Do not migrate:** self-assignable roles, mute roles, malicious URL/file lists, NSFW thresholds, mention
  config, blank-avatar and forbidden-name settings.
- Banned words are the awkward one: legacy rows carry both matching _and_ policy. The migration splits them — policy
  into `automoderator_banword_policies`, matching into the guild's native AutoMod keyword rules. A guild over the
  native limits (6 rules × 1,000 entries) needs a documented answer before the freeze window, not during it.
- Verify with two scratch databases, offset sequences, id-independent diff.
- Then tear down: legacy compose stack, its Caddy routing, and finally `postgres-old`.

## Scaling readiness

AutoModerator is the largest and most compute-heavy bot, so it's the intended first opt-in. The mechanism is
bot-core's to define; these are the invariants this codebase holds from P0 so that opting in is configuration rather
than a rewrite.

1. **No process-local state that must be globally consistent.** Anti-spam windows and trigger counts live in Redis
   and Postgres respectively — never in a module-level `Map`. The one existing process-local primitive,
   `withQueueLock`, is fine for per-guild-user ordering within a replica and must not be relied on for anything a
   second replica could also be doing.
2. **Everything gateway-driven is idempotent.** Redelivery after a reconnect is normal. Case creation, report filing
   and ladder increments all take an idempotency key.
3. **The scheduler claims rather than reads.** `FOR UPDATE SKIP LOCKED` from P2, so N replicas is safe by
   construction rather than by leader election.
4. **Read-modify-write paths are enumerated and lock-ready.** Ladder counting, report dedupe and case-number
   allocation are the three. Case numbers are already database-allocated.

   **Narrowed once the mechanism landed** ([12-horizontal-scaling.md](12-horizontal-scaling.md)): the other two do
   _not_ automatically need a Redis lock. A guild maps to exactly one shard owned by exactly one replica, so
   `withGuildUserLock` still serializes every guild-scoped gateway event and interaction for a guild+user pair,
   exactly as it does today — and DMs always arrive on shard 0. What genuinely needs a distributed lock is
   narrower: state `services/api` also mutates, and anything keyed on something other than a guild. Check which
   category a call site is in rather than assuming the broad version.

5. **Metrics are replica-safe.** No metric assumes a single process; the scrape config gains per-replica targets
   rather than the code aggregating.

## What to watch in the logs

The diagnosability bias that applied to Social applies harder here — this bot bans people.

- `automoderator_automod_events_total` flat at zero for a guild that has banword policies configured means the
  hybrid is broken for that guild: either no native rules exist, or the intent isn't granted. This is the failure
  mode most likely to be silent.
- `automoderator_dry_run_suppressions_total` non-zero in production means `resolveDryRun`'s `IS_PRODUCTION`
  short-circuit has been broken — actions the logs claim were taken did not happen. Zero in prod by construction.
- `automoderator_scheduler_lag_seconds` climbing means tempbans aren't expiring — the classic "why is this user
  still banned" report.
- `automoderator_log_dispatch_total{result="failed"}` means webhooks are 404ing; legacy self-healed by deleting the
  row, so a spike here is usually a deleted log channel, not an outage.
- Decision traces are the first thing to read for "why did/didn't the filter fire" — they carry the exemption and
  bypass evaluation, which outcome-only logs never did.

## Verification

Per [workflow.md](../workflow.md#verification-standard). Agent side: `yarn build`, `yarn lint`, `yarn test`,
`yarn format:check`; unit tests on pure logic; new API routes confirmed mounted (401, not 404); migration scripts
diffed against scratch databases.

Operator side, per phase, against the test guild:

- **P1** — each mod command files a correct case; case edit rewrites the log embed in place; a ban issued through the
  Discord UI still produces a case with the right moderator attached.
- **P2** — a tempban actually expires; a warn ladder step fires at the configured count; auto-pardon expires a warn.
- **P3** — both report menus; dedupe across two reporters; dismiss/restore; action → modal → case.
- **P4** — edit and delete logs carry old content; exemptions suppress; thread inheritance works.
- **P5** — trip a native rule and confirm the policy applies; each custom filter fires and is exempted correctly;
  bypass roles bypass; `/simulate` matches live behaviour.
- **P6** — each purge filter; join-age kick; invite lookup.
- **P9** — the full migration reconciliation, then a real guild's cases visible and correct on the new stack.

Dry-run is the safety net for all of this: exercise each destructive path in dry-run first and read the "would have"
output before letting it run live.
