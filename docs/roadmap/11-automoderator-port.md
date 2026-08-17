# AutoModerator port (monolith rebuild, feature-by-feature)

**Tracking issue:** to be created — this doc is referenced from it, not the other way around. **Depends on:** nothing
in flight. **Blocks:** the `postgres-old` teardown — AutoModerator is the last product still on the legacy stack, so
its cutover (P9) is what finally lets the old database and its compose stack die. **Live
production impact:** none until P9. Everything before that is additive: new tables, a new service, new routes, new
dashboard pages. Legacy AutoModerator (`origin/v2`, deployed from `ChatSift/stack`) keeps running untouched the whole
time.

## Status: P0, P1 and P3 done; P3b (DM reporting) next

Scope is settled for the ported features (36 surveyed, 26 in, 10 out — see [Scope](#scope)). Phasing below is
per-feature vertical slices, not layer-by-layer: each phase carries its own schema, API, bot and dashboard work so
nothing sits half-built across the stack.

**Phases are no longer being done strictly in order.** P3 (reports) was taken before P2 (scheduler and ladders) on
the owner's call, because [P3b](#p3b--dm-reporting) — a new feature, not a port — attaches to the report spine and
was the thing worth building next. P2 is unblocked and unstarted; nothing in P3 depends on it. The one place that
shows is the report card's action list, which offers no timed ban for the same reason `/ban` doesn't yet.

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
automoderator_reports_total{state}                            counter  filed|joined|dismissed|actioned
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

**Shipped 2026-08-14.** Build, lint, test and format:check green; runtime verification against the test guild is
still outstanding (see [Verification](#verification)).

The two open questions this phase carried both resolved on the owner's call:

- **Permission tiers: there are none, deliberately.** Discord's own `setDefaultMemberPermissions` gates every
  command (ModerateMembers to warn/mute, KickMembers to kick, BanMembers to ban/unban/softban), retunable by
  server admins in Server Settings → Integrations. Auditing legacy settled it: its `UserPerms.mod` and
  `UserPerms.admin` branches were literally the same expression, command gating was `default_member_permissions`
  in practice, and the only thing its checker actually decided was **immunity**. That is what
  `automoderator-bot/src/lib/permissions.ts` keeps, as a hierarchy check rather than a tier — and it earns its
  place because a WARN makes no Discord call at all, so nothing else would stop a moderator warning an admin.
- **No experiment gate this phase.** The safety net is `automoderator_guild_settings.dry_run` defaulting to true
  plus the bot not being in a production guild yet. The first real gate lands with a feature that can misfire —
  P5's filters.

Deviations from the table above, all deliberate:

- **`DELETE` as well as `PATCH` on a case**, matching legacy's `/case delete`.
- **No `duration` option on `/ban`, and no `/case duration` subcommand.** Both need the scheduler. A tempban whose
  expiry nothing lifts is a permanent ban that claims otherwise, so they land together at P2. A mute's expiry is
  Discord's to honour, so `/mute` is unaffected.
- **History-by-user is a `target_id` filter on the case list, not its own route.** "The browser, filtered" and
  "this user's history" are the same query, and the case-detail sidebar's _other cases for this user_ uses it too.
- **Feature 27 does not correlate at all.** Legacy listened for `GUILD_BAN_ADD`, then fetched the audit log and
  hoped the newest entry matched, inside a 30-second window. `GUILD_AUDIT_LOG_ENTRY_CREATE` (added with the
  `GuildModeration` intent) delivers the entry itself, so there is no race and no window — the entry's own id is
  the idempotency key, and its `user_id` is the attribution legacy fetched and then threw away. Two legacy bugs
  are therefore not carried forward: its ban/unban suppression condition was written inverted, and every observed
  manual action was left unattributed.
- **Webhook tokens are encrypted at rest** with `ENCRYPTION_KEY`, the same treatment `modmail_instances.token`
  gets. Legacy stored them in plaintext.
- **Manual _timeouts_ are not observed**, only manual bans, unbans and kicks — legacy's set. The audit entry for a
  timeout is a `MemberUpdate` needing change-key filtering, which is worth doing but is not what feature 27 was.

Three things moved to shared packages rather than being written twice, since P1 is the first phase with two
consumers of the same logic:

- `buildCaseEmbed` lives in `@chatsift/core` (beside `amaEmbeds.ts`): the bot posts the mod-log embed and the API
  rewrites it when a case is amended from the dashboard, and those must not drift.
- `isUniqueViolation` moved from `services/api/src/util/postgres.ts` into `@chatsift/db`, which owns the
  `postgres` dependency the check is about. The bot needs it for the idempotency-key insert.
- `memoizeAsync` was added to `@chatsift/core`'s `inflight.ts`. `bot-core`'s `/deploy` bootstrap and
  `services/api`'s `discordApplication.ts` had both hand-rolled "memoize an async lookup but don't remember a
  failure"; this became the shared version rather than a third copy. Neither existing one was converted —
  `bootstrapOnce` is entangled with the error it swallows, and `discordApplication.ts` is a _keyed_ memo, which
  would want a keyed variant.
- `getSelfId`/`setSelfId` in `bot-core/src/lib/selfId.ts`. The bot's own user id is in the READY payload
  (`data.user.id`), so `createBotClient` records it and nothing pays a `GET /users/@me` for it; the memoized
  fetch is only the fallback for a process that RESUMEd without ever seeing a READY. Consumed by the hierarchy
  guard and the audit observer.

**`/myhistory` and the member-facing page.** A member can read their own record without any dashboard access,
which no part of `isAuthed` could ever grant them — they aren't guild managers. `/myhistory` mints a
five-minute token (`backend-core`'s `automoderatorHistoryTokens.ts`, a uuid in Redis naming one user in one
guild) and links to `/automoderator/history/<token>`, an unauthenticated page served by
`GET /v3/automoderator/history/:token`. That route follows `ama/questions/publicAnswers.ts`: no `middleware` at
all, because there is no session to have.

Three deliberate calls there:

- **The token is not consumed on read**, only expired. Five minutes is the security control and it's absolute
  (nothing slides the TTL); burning it on first read would break refresh and the back button for no gain, since
  anyone holding the link inside the window can read it either way.
- **The public payload is narrower than the moderator one** — no moderator identity, no row id, no
  `log_message_id`, and pardoned cases excluded. Who actioned someone is staff information, and this page is
  shown to the person the case is about.
- **The link lives in the embed description, not the footer.** Discord renders no markdown in an embed footer,
  so a link there would be unclickable text; the footer keeps its counts summary. `/history` gets the same
  treatment, pointing at the gated case browser filtered to that user.

**Realtime.** The case browser subscribes to `automoderatorCasesChannel`, and the _bot_ publishes on it when a
case is filed or amended. That direction is the load-bearing one: cases originate in Discord — a moderator
running `/ban`, or the audit observer noticing a manual one — so without the bot publishing, the dashboard only
ever learned about them on a manual reload.

Also landed: the seed script deferred out of P0 (`yarn seed:automoderator --guild <id> [--reset]`), which fills a
guild with twelve cases spanning every action, a pardoned warn, a dry-run case, an unattributed case, and a log
webhook pointing at a channel that does not exist — the dangling-reference bug class the dashboard's selects keep
hitting.

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

**Shipped 2026-08-17.** Build, lint, test and format:check green, the six new routes confirmed mounted (401, not
404), the migration applied and the seed script re-run against the dev database; runtime verification against the
test guild is still outstanding (see [Verification](#verification)).

**Reporting is on or off per guild by whether a reports channel is set.** That's legacy's rule, kept deliberately:
it means there is exactly one thing to configure to turn the feature on, no queue can accumulate somewhere nobody
has anywhere to read it, and P3b gets the "is this guild accepting reports?" predicate it needs for free.

Deviations from the table above, all deliberate:

- **The reports channel is a plain channel, not an `automoderator_log_webhooks` row.** A report card carries
  buttons, and `components` on Execute Webhook requires an application-owned webhook — which the ones
  `services/api` creates with a bot token are not. Legacy posted these with the bot too. The cost is that the bot
  needs Send Messages and Embed Links in the channel where a log needs only a token;
  `automoderator_guild_settings.reports_channel_id` is where the setting lives.
- **`origin` (`GUILD`/`DM`) landed a phase early.** It is what decides whether the card renders a jump link, and a
  DM-origin report has a channel id staff could never open — so getting the distinction into the schema before
  there are rows is the difference between a column and a migration. Same reasoning as `automoderator_log_type`
  carrying all four values at P1. Nothing writes `DM` until P3b.
- **Dedupe splits by kind rather than following legacy's single rule.** A _message_ dedupes for all time, so one
  staff reviewed and dismissed can't be re-queued by the next person to find it; an _account-level_ report dedupes
  only while open, because "this account, again" is a legitimate new report once the last is closed. Legacy's
  version had no guild column at all, so one guild acknowledging a report made that account unreportable across
  every guild the deployment served, permanently. Not carried forward.
- **The card's state is derived from the row every time it is rendered.** Legacy decided whether it was dismissing
  or restoring by comparing the button's own _label_ to the string `'Dismiss'` — deriving state from the UI it had
  just rendered, which goes wrong the moment two moderators click at once.
- **Actioning is terminal.** Once a report has produced a case its Dismiss and Action buttons are disabled: the
  case is the record now, and live buttons would offer a second punishment for the same report. Legacy's `noop`
  action goes with it, since it set the state Dismiss already produces.
- **Per-action permission gating on the card.** Legacy gated its report buttons on _nothing_. Handling a report at
  all needs ModerateMembers; the action then needs whatever Discord's equivalent command needs (KickMembers to
  kick, BanMembers to ban), because `setDefaultMemberPermissions` gates a command by name and cannot gate a
  "pick a punishment" select. Without this, ModerateMembers on the card would silently grant BanMembers.
- **The reason picker is one modal, not legacy's select-then-maybe-a-modal.** A select menu is a legal child of a
  modal `Label`, so the presets and the free-text box live in the same interaction — which also means no pending
  report is held in a process-local collector that a restart or a second replica would lose. Both halves are
  joined when both are filled.
- **No timed ban in the action list**, for the same reason `/ban` has no duration: it needs P2's scheduler, and a
  tempban nothing lifts is a permanent ban that claims otherwise. No softban either — bulk message deletion isn't
  what a report about one message calls for.
- **Report cards go through `ActionExecutor`, so dry-run suppresses them**, like the mod log and for the same
  reason: that seam is the invariant P7 audits. The row is still written and the dashboard queue still shows it.
  The practical consequence is that **the test guild needs dry-run off to exercise P3's operator checks** — which
  it does anyway, since all of them end in a real punishment.
- **The card links to the dashboard**, in the embed description rather than the footer — Discord renders no
  markdown in a footer, the same finding `/history`'s link ran into at P1. The link is passed into
  `buildReportEmbed` rather than read from the context inside it, which is what keeps that a pure function of the
  row and unit-testable. `dashboardLinks.ts` owns every Discord→dashboard URL this bot builds, so the trailing
  slash `FRONTEND_URL` may or may not carry is dealt with once.
- **The detail view renders the reported content through `DiscordMarkdown`**, the renderer the ModMail thread view
  and the AMA/panel previews already use — a reported message is Discord message content, and staff deciding a
  report should not be reading raw `<@1234…>`. The queue list stays plain truncated text, matching `ThreadsList`.
- **The dashboard queue is read-only, as specced.** Handling a report means warning or banning somebody, and that
  path already exists on the card with the hierarchy and permission checks the bot enforces; a second copy on the
  dashboard would be a second copy of those checks.

Feature 30's hook point is `fileReport` in `automoderator-bot/src/lib/reports.ts`: it takes a reporter plus an
optional message snapshot and owns no Discord side effect, so P5's filter can call it with the bot as the reporter.
No dead code was added for it — the seam is simply the split between `fileReport` and `syncReportCard`, mirroring
`createCase`/`dispatchCaseLog`.

The seed script grew five reports and five preset reasons: a multi-reporter open report, a dismissed one, an
actioned one linked to a seeded case, an image-only report whose attachment url is already dead, and an
account-level one — plus reported messages pointing at a channel that never existed, which is the
dangling-reference class the dashboard's views keep hitting.

---

### P3b — DM reporting

**A new feature, not a port.** Legacy had nothing like it, and it is the first thing in this product that needs the
website as more than a config surface.

The problem: someone is harassed in DMs and wants to report it to a server they share with the sender. Today the
only evidence is a screenshot, which staff have no reason to trust. A user-installed message context menu hands us
Discord's _own_ copy of the message in the interaction payload, which is forgery-proof by construction — and needs
no Message Content intent, because the user explicitly invoked the command on it.

| Layer     | Work                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| Schema    | none — `origin` and the snapshot columns landed with P3                                       |
| API       | draft-token exchange, candidate-guild resolution, submission; widen `sanitizeRedirectTo`      |
| Bot       | user-installable "Add to report draft" menu, `/submit-report`, prompt-embed setup             |
| Dashboard | a public, OAuth-gated `/automoderator/report/<token>` page: preview, pick the server, confirm |

**The flow.**

1. The reporter installs AutoModerator as a **user app** (`ApplicationIntegrationType.UserInstall`), which is what
   makes a context menu available inside a DM at all.
2. `Add message to report draft` — contexts `PRIVATE_CHANNEL`/`BOT_DM` **only** — appends the targeted message's
   snapshot to a Redis draft keyed to that reporter and replies ephemerally with how long they have and what to run
   next. Each addition renews the TTL.
3. `/submit-report` mints a token naming that draft and replies with a link to the website.
4. The page sends them through the normal Discord OAuth flow, then shows the snapshot back to them and asks which
   server the report is for.
5. Confirming files an ordinary report with `origin = 'DM'` into that guild's queue — same card, same buttons, same
   action-to-case path P3 already built.

**Why the website hop is not a workaround.** It is the only fix for the thing that made this expensive in legacy
ModMail: answering "which guilds is this user in?" from a bot means iterating the bot's own guilds, because there is
no user→guild index. The OAuth `guilds` scope _is_ that index, and `services/api/src/routes/auth/discord.ts`
already requests it. The candidate set is then
`reporter's guilds ∩ bot:AUTOMODERATOR ∩ reports_channel_id IS NOT NULL` — three cheap lookups — and only the
survivors cost one `GET /guilds/{id}/members/{target}` each to confirm the target is there too. That is 0–5 calls in
practice, not thousands, and it goes through `services/discord-proxy` like everything else.

**Decisions already taken, so they don't get re-litigated:**

1. **Multi-message drafts, not one-shot.** A snapshot is forgery-proof but not context-proof: the reporter still
   chooses _which_ message, and a baited reply reads very differently alone. Accumulating lets them include their
   own side, and the card must say plainly that staff are seeing a reporter's selection out of a conversation they
   cannot see.
2. **The token is not a bearer credential.** It names a draft holding private DM content, so it is bound to the
   Discord user who minted it and checked against the session _after_ OAuth. This is deliberately a different
   security model from `automoderatorHistoryTokens.ts`, which _is_ a bearer token — the resemblance is the trap.
3. **DM contexts only.** A user-installed message menu also fires in guilds the bot isn't in. Letting a message
   captured in guild A be filed into guild B would be a cross-server surveillance tool, which is a far larger
   product than this. In-guild reporting stays P3's separate, guild-installed menus.
4. **The candidate list is filtered to guilds the target is also in, and the copy is deliberately vague about why a
   server is missing** ("if they're a member, that community might not be accepting reports"). The vagueness is the
   mitigation: it stops the picker doubling as a membership oracle, because the reporter cannot tell "not a member"
   from "reports disabled".
5. **We do not re-host attachments.** Discord copies an embed image it is handed into the message it posts, so the
   card keeps the evidence alive past the original url's signature — the same mechanism P3's card already relies on
   and the behaviour `discordAttachments.ts` documents. The exposure window is only between snapshot and
   confirmation.
6. **No rate limiting and no reporter blocklist.** Owner's call: guilds can deal with abusive reporters themselves,
   and a report costs a Redis write plus a message. Revisit only if load says otherwise.
7. **Message forwarding was considered and rejected.** Forwarding a DM into a bot DM would skip the install step
   entirely, but forwarded-message snapshots appear not to carry the original `author`, which destroys attribution
   — the one thing the feature exists for.

**Accept knowingly:** staff can never independently corroborate a DM report. Every other report type has a jump
link; this one is trust in ChatSift's chain of custody, and the card should say so rather than let a moderator
assume otherwise.

**Operator prerequisite, in the same category as `AUTOMODERATOR_BOT_TOKEN`:** _User Install_ must be enabled for
the application in the Discord developer portal. Nothing in this repo can do that, and the context menu will not
appear in DMs until it is.

**Setup side.** Staff create a prompt in their server — the same shape as a ModMail panel or an AMA submission
prompt — with default copy explaining the flow and a link-type button pointing at the user-install URL. The
reporter's realistic path is five steps (bad DM → find the prompt → install → back to the DM → menu), so that
install link wants to be somewhere findable rather than in one channel only.

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
- Then tear down: legacy compose stack, then `postgres-old`. Its ingress is no longer separate — since #305 the
  `interactions.`/`logs.` routes are two blocks in `build/caddy/Caddyfile`, and the `legacy` external network in
  `docker-compose.yml` exists only to reach them. All three go in the same commit; nothing else uses that network.

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
- `automoderator_reports_total{state="filed"}` climbing with neither `dismissed` nor `actioned` following it means
  a guild's queue is filling up and nobody is reading it -- which is the failure mode a report queue has that a
  mod log doesn't.
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
- **P3** — both report menus; dedupe across two reporters; dismiss/restore; action → modal → case. Needs
  dry-run **off** for the guild: the card is a Discord side effect and goes through `ActionExecutor`.
- **P3b** — install the user app, add two DM messages to a draft, submit, and confirm the picker lists only
  servers you and the sender share that accept reports; then confirm the filed report's card carries no jump
  link and its action path still produces a case.
- **P4** — edit and delete logs carry old content; exemptions suppress; thread inheritance works.
- **P5** — trip a native rule and confirm the policy applies; each custom filter fires and is exempted correctly;
  bypass roles bypass; `/simulate` matches live behaviour.
- **P6** — each purge filter; join-age kick; invite lookup.
- **P9** — the full migration reconciliation, then a real guild's cases visible and correct on the new stack.

Dry-run is the safety net for all of this: exercise each destructive path in dry-run first and read the "would have"
output before letting it run live.
