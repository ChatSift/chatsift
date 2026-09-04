# AutoModerator port (monolith rebuild, feature-by-feature)

**Tracking issue:** to be created -- this doc is referenced from it, not the other way around. **Depends on:** nothing
in flight. **Blocks:** the `postgres-old` teardown -- AutoModerator is the last product still on the legacy stack, so
its cutover (P9) is what finally lets the old database and its compose stack die. **Live
production impact:** none until P9. Everything before that is additive: new tables, a new service, new routes, new
dashboard pages. Legacy AutoModerator (`origin/v2`, deployed from `ChatSift/stack`) keeps running untouched the whole
time.

## Status: P0–P4 done; P5's three PRs are all written — P5a (#365) and P5b (#367) are merged, P5c is open in #368 and unverified

Scope is settled for the ported features (36 surveyed, 26 in, 10 out -- see [Scope](#scope)). Phasing below is
per-feature vertical slices, not layer-by-layer: each phase carries its own schema, API, bot and dashboard work so
nothing sits half-built across the stack.

**Phases are no longer being done strictly in order.** P3 (reports) was taken before P2 (scheduler and ladders) on
the owner's call, because [P3b](#p3b--dm-reporting) -- a new feature, not a port -- attaches to the report spine and
was the thing worth building next. P2 followed and closed the gap that left: `/ban --duration`, `/case duration`
and the report card's timed ban all landed with the scheduler that makes them mean anything.

P0 landed 2026-08-13 and is verified end to end against the test guild -- see its section for what shipped and the
two deviations. **The AutoMod spike passed**, so feature 01's design and P5's scope are settled on evidence rather
than assumption; see [The AutoMod hybrid](#the-automod-hybrid).

## Owner decisions already made

Recorded so they don't get re-litigated.

1. **Monolith, not microservices.** Legacy's seven services (`gateway`, `discord-proxy`, `interactions`, `automod`,
   `mod-observer`, `logging`, `scheduler`) collapse into one `services/*-bot` process on `@chatsift/bot-core`, exactly
   like AMA, ModMail and Social. The split is what created the need for a broker in the first place. The one
   exception is `discord-proxy`, which came back as a stack-wide `services/discord-proxy` for a reason legacy
   didn't have -- a bot's token being used from both its bot process and `services/api` -- but it's shared
   infrastructure this port consumes, not a per-bot service. See
   [01-architecture.md §11](01-architecture.md#11-discord-rest-proxy-servicesdiscord-proxy).
2. **AMQP is gone. Redis is the only broker.** See [Brokerage](#brokerage-what-actually-needs-a-broker) -- most of
   legacy's three AMQP exchanges become in-process function calls, and what genuinely remains cross-process already
   has a mechanism in `backend-core`.
3. **Per-feature phasing.** Foundations first (schema baseline, API surface, dashboard scaffold, observability,
   dev affordances), then one feature at a time through the full stack.
4. **First bot to opt into bot-core horizontal scaling.** The mechanism now exists
   ([12-horizontal-scaling.md](12-horizontal-scaling.md)) and opting in is configuration, as intended. This doc's
   job is still to ensure AutoModerator is _shaped_ for it. See [Scaling readiness](#scaling-readiness).
5. **The invite worker is dropped.** `invite-lookup.chatsift.workers.dev` is live but its source isn't in this repo
   and nothing on `main` calls it. Invite resolution happens through the bot's own REST client instead.
6. **Banword matching is delegated to Discord.** Feature 01 ships no matcher -- see
   [The AutoMod hybrid](#the-automod-hybrid).
7. **Cases migrate for real.** Like Social's XP, case history is accumulated state; it cannot drain. P9 is a
   script + `--verify` + freeze window, following the Social precedent.

## Scope

The full 36-feature survey (what each feature was, when it shipped, what Discord has since absorbed, and the
per-feature port decision) lives outside this doc. The decision totals:

- **26 ported** -- 23 substantially as-was, 3 reshaped (01 banwords, 09 filter exemptions, 33 filter log).
- **10 dropped** -- 04 global malicious-URL filter, 05 file-hash filter (already deleted in 2022), 06 NSFW
  inference, 08 mention limit/rate, 14 blank-avatar kick, 15 forbidden names, 16 mute-role reapplication, 21
  role-mute machinery, 25 raid cleanup, 36 self-assignable roles.

Four consequences of the drops, accepted knowingly:

- **Mutes cap at four weeks.** Native timeouts only. Anything longer is a tempban or nothing.
- **The `name` banword flag disappears** with feature 15 -- the one part of 01's flag model that doesn't survive.
- **No criteria-driven raid response.** Avatar-hash selection goes with feature 25; the fallback is Discord's
  security actions plus members-page multi-select.
- **Self-assignable role data does not migrate.** `self_assignable_roles*` is dropped at P9, not ported. The
  prompt _messages_ outlive the data, though -- they sit in guild channels with their buttons baked in, and P9
  reuses the legacy application's token, so their clicks keep arriving. `legacyRolePrompts.ts` answers them
  ephemerally with a pointer to Discord Onboarding (#385) rather than letting them fail; it hangs off
  `registerUnknownComponentResolver`, because the legacy custom_ids (`roles-manage-prompt`,
  `roles-manage-simple|<roleId>`, `roles-manage|<promptId>|<index>`) don't use the `name:state` shape the
  component dispatcher splits on. `automoderator_feature_invocations_total{feature="legacy_role_prompt"}`
  going quiet is what says the notice can be deleted.

## New-stack mapping

| Legacy (`origin/v2`)                            | New                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 7 services + AMQP fanout                        | one `services/automoderator-bot` process                                                  |
| `services/gateway` (custom gateway)             | `createBotGateway` from `@chatsift/bot-core`                                              |
| `services/discord-proxy` (shared REST cache)    | `services/discord-proxy` -- rate limiting only; the route cache is dropped                |
| `services/interactions` (+ its own HTTP server) | `registerCommandHandlers` / `registerUnknownCommandResolver`                              |
| `services/automod` runner pipeline              | in-process filter pipeline, same transform → check → run → cleanup → log shape            |
| `services/mod-observer`                         | in-process gateway listeners                                                              |
| `services/logging` (AMQP consumer → webhooks)   | in-process log dispatcher, same webhook-token storage                                     |
| `services/scheduler` (10s poll)                 | in-process sweeps claiming off the case row itself (see [P2](#p2--scheduler-and-ladders)) |
| Prisma + `prisma/schema.prisma`                 | `packages/private/db/schema/schema.sql` + Atlas migration + kanel regen                   |
| `tsyringe` DI container                         | `initContext`/`getContext` from `@chatsift/backend-core`                                  |
| `cordis` brokers / bitfields / util             | `@discordjs/core`, plain TS                                                               |
| Cloudflare invite-lookup worker                 | `rest.get(Routes.invite(code))` on the bot's own token                                    |
| Own banword matcher                             | Discord AutoMod keyword rules + `AUTO_MODERATION_ACTION_EXECUTION`                        |
| `apps`/`sigs` app-auth model                    | existing dashboard-grant + `isAuthed` machinery                                           |
| Separate `chatsift/dashboard`                   | `apps/website` under a new product tab                                                    |

### Naming — decide before P0

The service, the `BotId`, the env var and the `bot:<BotId>` Redis key all bake in at P0 and are expensive to change
after. The collision worth avoiding: **our filter subsystem and Discord's AutoMod are different things**, and feature
01 makes them talk to each other constantly.

Recommendation: service `services/automoderator-bot`, `BotId` `'AUTOMODERATOR'`, env `AUTOMODERATOR_BOT_TOKEN`.
Longer than the `ama`/`modmail`/`social` precedent, but it keeps "AutoModerator" (the product) and "AutoMod"
(Discord's feature) textually distinct everywhere -- including in log lines and metric labels, where the ambiguity
would otherwise be permanent. The rest of this doc assumes it.

## The AutoMod hybrid

Feature 01 is the one genuinely novel piece of architecture in the port, and two other features hang off it, so it's
specified here rather than buried in a phase.

Discord's AutoMod does the matching: 6 keyword rules per guild, 1,000 entries each, 10 regex patterns per rule, allow
lists, per-rule role and channel exemptions. What it cannot do is respond with anything but block / alert / timeout /
quarantine. AutoModerator supplies the response layer.

**Mechanism.** Subscribe to `AUTO_MODERATION_ACTION_EXECUTION` (needs the `AutoModerationExecution` gateway intent).
The payload carries `rule_id`, `matched_keyword` and `matched_content`.

**Keying.** Policy rows key on `(rule_id, matched_keyword)`, with a **nullable** keyword meaning "any hit on this
rule". Keyword-level wins when both match, which preserves legacy's per-word model (`warn`/`mute`/`kick`/`ban`/
`report` + a per-entry mute duration) while still covering the two rule kinds a keyword cannot name: a _preset_
rule matches a word list Discord does not expose, and a _regex_ rule returns the pattern. Keying on `rule_id`
alone would coarsen policy and lose the feature; keying on the keyword alone -- which this doc specified until
P5a -- cannot express the other two at all.

**One trigger, several events.** `AUTO_MODERATION_ACTION_EXECUTION` is dispatched once per _executed action_, not
once per trigger, so a rule that blocks and times out fires two. The response layer deduplicates on
`(guild, rule, user, message id or content hash)` with a short TTL -- see `automodDedupe.ts` for why that is a
separate mechanism from the case row's permanent idempotency key rather than a replacement for it.

**What this obliges.** Three things that need saying out loud because they're new coupling:

- The bot no longer controls whether a message is deleted -- Discord already blocked it before the event arrives.
  Feature 30 ("report instead of delete") becomes "report, and configure that rule to alert rather than block". The
  policy survives; the suppression point moves into Discord's rule config, which means **the dashboard has to be able
  to read AutoMod rules**, not just our own table. Read, not write -- P5a settled that this product never writes a
  rule, from the dashboard or from the P9 migration; see [P5](#p5--filters) for what that buys and costs.
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

1. **Caches** -- the message cache that makes edit/delete logging possible (feature 34), and the anti-spam sorted
   sets (feature 07). Same semantics as legacy; keys documented in code.
2. **Dashboard realtime invalidation** -- already exists and is reused verbatim: `publishRealtimeInvalidate` in
   `backend-core/src/lib/realtimeBroadcast.ts` over the `ws:invalidate` channel, consumed by the API's WS gateway.
   Every mutating route declares `realtimeChannel` and gets it for free.
3. **The guild list** -- `bot:AUTOMODERATOR`, same as every other bot.
4. **Distributed locks** -- still not needed at P8, in most places. `withGuildUserLock` is process-local, which
   stays correct under sharding because a guild's events only ever reach one replica. See
   [Scaling readiness](#scaling-readiness) item 4 for the narrow set that genuinely needs a Redis lock.

**No queue library.** The scheduler stays a polled table, as it was in legacy. BullMQ or similar would be a new
dependency buying a delay/claim model this implements in about forty lines, and would put job state somewhere
other than the database the rest of the product's state lives in. P2 went further than "no library" and dropped
the separate task table too -- the case row is the schedule; see [P2](#p2--scheduler-and-ladders).

## Cross-cutting foundations

These land in P0 and every subsequent phase is expected to use them. They are the difference between "26 features
ported" and "26 features that can be operated".

### Observability

Reuses the API's shape from #277 (`services/api/src/core/metrics.ts`): a dedicated `prom-client` `Registry`, not the
process-wide default, so the scrape output stays exactly what was asked for.

**Collection is always on; exposure is gated.** Instrumentation compiles in and records unconditionally, in dev as
well as prod -- a mislabelled or never-incremented metric that only runs in production is a bug you find in
production. What `ENV.IS_PRODUCTION` gates is _binding the HTTP endpoint_. This is a deliberate reading of "data
collection in place when `IS_PRODUCTION` is true": the counters are cheap in-memory adds, and having dev exercise the
same code path is worth more than the microseconds.

**Endpoint.** A minimal HTTP listener on the bot serving `/metrics`, guarded by the same Bearer-token
`requireMetricsSecret` approach the API uses (`METRICS_SECRET`, read by Prometheus from
`build/prometheus/metrics_secret`). Adding the scrape job is six lines in `build/prometheus/prometheus.yml` when
wanted -- deliberately **not** part of any phase here, per the owner's call.

**Metric taxonomy.** Feature-level, which is the point -- "is feature N working in prod" should be answerable without
reading logs.

```
automoderator_feature_invocations_total{feature, outcome}     counter  outcome: applied|skipped|failed
automoderator_feature_duration_seconds{feature}               histogram
automoderator_moderation_actions_total{action, source}        counter  action: warn|mute|kick|ban|unban|delete
                                                                       source: command|automod|ladder|report|scheduler|observer
automoderator_cases_created_total{action, source}             counter
automoderator_filter_hits_total{filter}                       counter  filter: words|urls|invites|antispam
automoderator_automod_events_total{action_type, matched}      counter  native AUTO_MODERATION_ACTION_EXECUTION intake
automoderator_scheduler_tasks_total{type, result}             counter
automoderator_scheduler_lag_seconds{type}                     histogram  run_at → actually ran
automoderator_reports_total{state}                            counter  filed|joined|dismissed|restored|actioned
automoderator_log_dispatch_total{log_type, result}            counter  webhook delivery health
automoderator_discord_errors_total{status, route_class}       counter
```

**Cardinality discipline, non-negotiable:** never label by `guild_id`, `user_id`, `channel_id`, `message_id` or
matched content. Every label above is drawn from a closed set known at compile time. This is the same rule the API's
metrics module already states about route patterns versus resolved URLs, and it's the one mistake that turns a
metrics endpoint into an outage.

### The action seam

Every side-effecting Discord call -- ban, kick, timeout, role change, message delete, DM, webhook post -- goes through
a single `ActionExecutor` seam. **Nothing else calls REST for a side effect.** That single chokepoint is the one
place that can guarantee every action is counted and traced, and it's cheap only if it's established in P0, before
there are call sites to retrofit.

**There is deliberately no observe-only mode.** P0 shipped one -- a per-guild `dry_run` flag that suppressed every
Discord side effect while still filing the case it would have filed -- and it was removed once the port was
feature-complete. It was a development affordance by construction (`resolveDryRun` short-circuited to live whenever
`IS_PRODUCTION`, so production could neither enter it nor be stuck in it), and paying for it in the schema, the API,
the dashboard, the case embed, and a `suppressed` branch on every reply the punishment path writes was more than a
dev-only knob is worth. Per-feature experiment gating (below) is the production kill switch, and it's the
better-shaped one, since it can be flipped for a single guild without a deploy.

### Feature gating

The `experiments` / `experiment_overrides` tables already exist in `schema/schema.sql` -- `name` + `range_start` /
`range_end` for a guild-hash bucket rollout, plus per-guild overrides. They have generated kanel types and **no
runtime consumers**: dormant infrastructure, not a new dependency.

Reviving them is exactly what per-feature phasing wants. Each feature ships behind a named experiment, enabled for
the test guild by override, then widened by range. It also gives an operator a per-guild kill switch that doesn't
need a deploy -- which matters more here than in any other product, because a misfiring filter bans people.

P0 builds the read helper and the override admin path. If a phase's feature has no sensible gate, say so in that
phase rather than skipping it silently.

### Dev and test affordances

In rough order of how much time each saves:

1. **`/simulate <message>`** -- push a synthetic message through the whole filter pipeline and get back which runners
   fired, which entries matched, which exemptions applied, and what would have happened. Tunes filters without
   spamming a channel, and is the single highest-value affordance in this list.
2. **Decision traces.** Every automod decision emits one structured log line carrying the full reason chain: runner,
   matched entry, exemption checked, bypass evaluated, ladder position, action taken or suppressed. Legacy logged
   outcomes; the gap was always _why_ something didn't fire.
3. **Seeded guild fixtures.** One script that fills a guild's config -- banwords, allowlists, ladders, log channels --
   so a fresh dev database is usable immediately. Seed it with some deliberately dangling channel/role IDs: that's
   the bug class the dashboard selects have hit repeatedly.
4. **Injected clock.** The scheduler, ladder decay and auto-pardon are all time-driven; a `now()` provider makes
   them unit-testable without sleeping.
5. **Idempotency keys on case creation.** Gateway redelivery after a reconnect is normal, and legacy's 30-second
   audit-log correlation window (feature 27) is exactly the shape of code that double-fires. Required for P8
   regardless.
6. **`/whyami`-style introspection** -- given a member, print which bypass roles, exemptions and gates currently apply
   to them. Answers "why didn't the filter catch that" in one command.

## Phases

Additive throughout; nothing touches legacy until P9. Each phase ends verified per
[workflow.md](../workflow.md#verification-standard) -- build/lint/test green **and** the change exercised against the
test guild. Each phase lists its slice across all four layers; "--" means that layer has no work.

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
behave as documented, feature 01's design changes and P5 gets rescoped -- which is why it happens in P0 and not in P5.

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
the override admin path is `GET`/`PUT`/`DELETE /v3/experiments[/:name]` -- global-admin only, declarative override
sets, no dashboard page. **P0 itself gates nothing**: there is no feature to switch off yet, and the first real gate
is P1's.

Verified against the test guild: `/deploy` registers all three commands, the spike round trip works (see
[The AutoMod hybrid](#the-automod-hybrid)), the dashboard tab/hub/config page render and persist, and `/metrics`
is correctly unbound outside production.

Deployment prerequisite: `AUTOMODERATOR_BOT_TOKEN` is a required var read by `services/api` as well as the bot,
so it must exist in `.env.private` before _any_ service boots -- the shape of the 2026-08-11 incident the
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

- `/softban` ships despite being redundant against the native ban dialog -- owner's call, parity wins.
- Permission tiers: legacy collapsed `mod` and `admin` to the same check. **Don't carry that forward** -- decide the
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
  `automoderator-bot/src/lib/permissions.ts` keeps, as a hierarchy check rather than a tier -- and it earns its
  place because a WARN makes no Discord call at all, so nothing else would stop a moderator warning an admin.
- **No experiment gate this phase.** The safety net was `automoderator_guild_settings.dry_run` defaulting to true
  (since removed -- see "The action seam") plus the bot not being in a production guild yet. The first real gate
  lands with a feature that can misfire -- P5's filters.

Deviations from the table above, all deliberate:

- **`DELETE` as well as `PATCH` on a case**, matching legacy's `/case delete`.
- **No `duration` option on `/ban`, and no `/case duration` subcommand.** Both need the scheduler. A tempban whose
  expiry nothing lifts is a permanent ban that claims otherwise, so they land together at P2. A mute's expiry is
  Discord's to honour, so `/mute` is unaffected.
- **History-by-user is a `target_id` filter on the case list, not its own route.** "The browser, filtered" and
  "this user's history" are the same query, and the case-detail sidebar's _other cases for this user_ uses it too.
- **Feature 27 does not correlate at all.** Legacy listened for `GUILD_BAN_ADD`, then fetched the audit log and
  hoped the newest entry matched, inside a 30-second window. `GUILD_AUDIT_LOG_ENTRY_CREATE` (added with the
  `GuildModeration` intent) delivers the entry itself, so there is no race and no window -- the entry's own id is
  the idempotency key, and its `user_id` is the attribution legacy fetched and then threw away. Two legacy bugs
  are therefore not carried forward: its ban/unban suppression condition was written inverted, and every observed
  manual action was left unattributed.
- **Webhook tokens are encrypted at rest** with `ENCRYPTION_KEY`, the same treatment `modmail_instances.token`
  gets. Legacy stored them in plaintext.
- **Manual _timeouts_ are not observed**, only manual bans, unbans and kicks -- legacy's set. The audit entry for a
  timeout is a `MemberUpdate` needing change-key filtering, which is worth doing but is not what feature 27 was.

Three things moved to shared packages rather than being written twice, since P1 is the first phase with two
consumers of the same logic:

- `buildCaseEmbed` lives in `@chatsift/core` (beside `amaEmbeds.ts`): the bot posts the mod-log embed and the API
  rewrites it when a case is amended from the dashboard, and those must not drift.
- `isUniqueViolation` moved from `services/api/src/util/postgres.ts` into `@chatsift/db`, which owns the
  `postgres` dependency the check is about. The bot needs it for the idempotency-key insert.
- `memoizeAsync` was added to `@chatsift/core`'s `inflight.ts`. `bot-core`'s `/deploy` bootstrap and
  `services/api`'s `discordApplication.ts` had both hand-rolled "memoize an async lookup but don't remember a
  failure"; this became the shared version rather than a third copy. Neither existing one was converted --
  `bootstrapOnce` is entangled with the error it swallows, and `discordApplication.ts` is a _keyed_ memo, which
  would want a keyed variant.
- `getSelfId`/`setSelfId` in `bot-core/src/lib/selfId.ts`. The bot's own user id is in the READY payload
  (`data.user.id`), so `createBotClient` records it and nothing pays a `GET /users/@me` for it; the memoized
  fetch is only the fallback for a process that RESUMEd without ever seeing a READY. Consumed by the hierarchy
  guard and the audit observer.

**`/myhistory` and the member-facing page.** A member can read their own record without any dashboard access,
which no part of `isAuthed` could ever grant them -- they aren't guild managers. `/myhistory` mints a
five-minute token (`backend-core`'s `automoderatorHistoryTokens.ts`, a uuid in Redis naming one user in one
guild) and links to `/automoderator/history/<token>`, an unauthenticated page served by
`GET /v3/automoderator/history/:token`. That route follows `ama/questions/publicAnswers.ts`: no `middleware` at
all, because there is no session to have.

Three deliberate calls there:

- **The token is not consumed on read**, only expired. Five minutes is the security control and it's absolute
  (nothing slides the TTL); burning it on first read would break refresh and the back button for no gain, since
  anyone holding the link inside the window can read it either way.
- **The public payload is narrower than the moderator one** -- no moderator identity, no row id, no
  `log_message_id`, and pardoned cases excluded. Who actioned someone is staff information, and this page is
  shown to the person the case is about.
- **The link lives in the embed description, not the footer.** Discord renders no markdown in an embed footer,
  so a link there would be unclickable text; the footer keeps its counts summary. `/history` gets the same
  treatment, pointing at the gated case browser filtered to that user.

**Realtime.** The case browser subscribes to `automoderatorCasesChannel`, and the _bot_ publishes on it when a
case is filed or amended. That direction is the load-bearing one: cases originate in Discord -- a moderator
running `/ban`, or the audit observer noticing a manual one -- so without the bot publishing, the dashboard only
ever learned about them on a manual reload.

Also landed: the seed script deferred out of P0 (`yarn seed:automoderator --guild <id> [--reset]`), which fills a
guild with twelve cases spanning every action, a pardoned warn, an unattributed case, and a log
webhook pointing at a channel that does not exist -- the dangling-reference bug class the dashboard's selects keep
hitting.

---

### P2 — Scheduler and ladders

Features **20** (timed actions), **22** (warn ladder), **23** (auto-pardon).

| Layer     | Work                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| Schema    | ~~`automoderator_tasks`~~, `automoderator_warn_punishments`, `auto_pardon_warns_after` setting |
| API       | ladder CRUD, auto-pardon config                                                                |
| Bot       | scheduler loop with `SKIP LOCKED` claim; tempban expiry; ladder evaluation on warn             |
| Dashboard | ladder editor, auto-pardon setting                                                             |

The scheduler claims with `FOR UPDATE SKIP LOCKED` from day one rather than assuming one replica -- see
[Scaling readiness](#scaling-readiness). Metrics: `scheduler_lag_seconds` is the one to alert on later.

**Shipped 2026-08-17** (#361). Build, lint, test and format:check green; the three new routes confirmed mounted,
the migrations applied, both sweeps' claim queries checked against the seeded dev database (each finds exactly
the row planted for it, and the expiry claim uses its partial index). Runtime verification against the test guild
is still outstanding -- see [Verification](#verification).

**The ladder cap is serialized with a per-guild advisory lock.** Checked inside the insert it is only
approximate: under READ COMMITTED two concurrent writes for _different_ warn counts each snapshot the count at
24, both pass, and the guild lands on 26 -- reproduced, and closed by `pg_advisory_xact_lock`. This was declined
on the first review pass and taken on the second, because the fact that decided it changed: the route had since
grown a transaction for the atomic renumber, so the lock went from "new machinery for a cosmetic off-by-one" to
one line inside a transaction that already existed. A guild id is a snowflake, so it fits `bigint` exactly and
needs no hashing to collide with.

`createPreset.ts` still has the unserialized version of this shape from P3, where the consequence is actually
worse -- a 26th preset is silently never offered, because the picker reads `LIMIT 25`, where a 26th rung works
fine. Worth revisiting, but it is P3's route rather than this phase's to change.

**There is no `automoderator_tasks` table.** That is the phase's one real design departure, taken on the owner's
call to design rather than port. Legacy had a task table plus a 1:1 `timed_case_tasks` join row, and in five
years it only ever held one task type whose entire payload was a case id. So the case row _is_ the schedule:
`automoderator_cases.expires_at` with a null `lifted_at` is what makes a tempban due, over a partial index that
is exactly the sweep's access path. What that buys:

- `/case duration` is one `UPDATE`, and `/case delete` needs no cascade -- there is no second row to keep in
  step with the case through either.
- An `/unban` that beats the scheduler closes the tempban out, wherever it came from. The hook is in
  `createCase`, so a moderator lifting a ban through **Discord's own UI** counts too, via the audit observer.
  Legacy's task pointed at a case row and could not notice later ones at all.
- `lifted_at` is a fact about the punishment worth reading back, where a deleted task row was bookkeeping.

Both sweeps claim the same way and for the same reason -- write first, act second, exactly the shape P3's report
action uses. The expiry sweep's claim is an `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so
concurrent replicas take disjoint slices instead of queueing on each other's locks, and no lock is held across a
Discord call. Neither sweep wants an `ownsShardForGuild` filter (contrast ModMail's four): they _claim_ rather
than read, so filtering by shard would only leave a guild's expired bans sitting there whenever the replica that
owns it lost the race.

Other deliberate calls:

- **A failed expiry retries forever rather than giving up.** Legacy counted attempts and deleted the task after
  three -- which turns a temporary ban into a permanent one that claims otherwise, the exact failure this feature
  exists to prevent. There is no `attempts` column; the claim is rolled back and `scheduler_lag_seconds`
  climbing is the signal.
- **`/case duration` is gated by the case's own action, not by `/case`'s.** `/case` sits at ModerateMembers, and
  re-timing a ban into the past makes the sweep unban somebody -- so without this, ModerateMembers would silently
  grant BanMembers. The same hole `memberMayTakeAction` was written to close on the report card, and the same
  helper closes it here. Also raised on #361.
- **Renumbering a step is one atomic write**, via a `replaces` field on the PUT rather than the reward form's
  PUT-then-DELETE. That shape had two problems review found: a guild on a full ladder could never reorder (the
  insert saw a full ladder because the delete had not happened yet), and a failure between the halves left a
  duplicate step.
- **Both sweeps self-reschedule rather than running on `setInterval`.** Their batch sizes only bound in-flight
  Discord work if one batch is in flight at a time; a rate-limited run outlasting its interval would otherwise
  stack. Same shape and reasoning as `modmail-bot`'s auto-archive sweep. It costs nothing in correctness -- both
  claim atomically, so overlapping runs would take disjoint work -- and buys being able to reason about load.
- **A rung matches an exact warn count**, legacy's rule -- at-least would re-fire the same punishment on every
  subsequent warn. The dashboard's ladder overview renders the counts _between_ rungs as collapsed
  "recorded only" rows, because that gap is the thing people get wrong and a list of independent cards hides it.
- **A ladder failure is its own error.** `LadderFailureError` carries the warn, so the moderator is told both
  halves: the warn was recorded, and the punishment it triggered was not. Swallowing it would silently drop an
  escalation. It is also the one failure the report card must **not** roll its claim back for -- the warn landed,
  so reopening the report would let the next moderator action it into a second warn and push the target up
  another rung. The card keeps it ACTIONED and points `case_id` at the warn that did land. Caught in review on
  #361; the general "a failed punishment must reopen the report" rule is right for every other error.
- **No experiment gate**, and the reason is that every part of this phase is off unless configured: a guild with
  no rungs gets nothing, a null `auto_pardon_warns_after` is off, and a ban without a duration is permanent.
  Deleting the rung is a better kill switch than a gate, since it is also the thing an operator would reach for.
  The first real gate is still P5's.
- **A mute's 28-day ceiling is enforced where rows are written**, not where they are read -- `services/api` for
  anything a human configures, and P9's migration for anything legacy hands over. A runtime clamp would be a
  second place for the rule to live and the one that can only paper over a bad row.
- Also landed: `/ban --duration`, `/case duration` (bans reschedule, mutes re-time the Discord timeout, both
  measured from when the case was filed), and an optional duration on the report card's Ban modal -- the three
  things P1 and P3 deferred to this phase.

---

### P3 — Reports

Features **29** (report queue), **30** (filter-driven reports, hook point only).

| Layer     | Work                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_reports`, `automoderator_reporters`, `automoderator_report_presets`                      |
| API       | preset CRUD; report list/detail for the dashboard                                                       |
| Bot       | report context menu, report card with dismiss/restore/view-reporters/action, action → modal → real case |
| Dashboard | preset config; read-only report queue view                                                              |

Feature 30's automod trigger lands in P5; P3 builds the entry point and proves it with a manual report.

**Shipped 2026-08-17.** Build, lint, test and format:check green, the six new routes confirmed mounted (401, not
404), the migration applied and the seed script re-run against the dev database; runtime verification against the
test guild is still outstanding (see [Verification](#verification)).

**Reporting is on or off per guild by whether a reports channel is set.** That's legacy's rule, kept deliberately:
it means there is exactly one thing to configure to turn the feature on, no queue can accumulate somewhere nobody
has anywhere to read it, and P3b gets the "is this guild accepting reports?" predicate it needs for free.

Deviations from the table above, all deliberate:

- **The reports channel is a plain channel, not an `automoderator_log_webhooks` row.** A report card carries
  buttons, and `components` on Execute Webhook requires an application-owned webhook -- which the ones
  `services/api` creates with a bot token are not. Legacy posted these with the bot too. The cost is that the bot
  needs Send Messages and Embed Links in the channel where a log needs only a token;
  `automoderator_guild_settings.reports_channel_id` is where the setting lives.
- **`origin` (`GUILD`/`DM`) landed a phase early.** It is what decides whether the card renders a jump link, and a
  DM-origin report has a channel id staff could never open -- so getting the distinction into the schema before
  there are rows is the difference between a column and a migration. Same reasoning as `automoderator_log_type`
  carrying all four values at P1. Nothing writes `DM` until P3b.
- **Dedupe splits by kind rather than following legacy's single rule.** A _message_ dedupes for all time, so one
  staff reviewed and dismissed can't be re-queued by the next person to find it; an _account-level_ report dedupes
  only while open, because "this account, again" is a legitimate new report once the last is closed. Legacy's
  version had no guild column at all, so one guild acknowledging a report made that account unreportable across
  every guild the deployment served, permanently. Not carried forward.
- **State transitions are compare-and-swap, not bare writes.** `setReportState` takes an `expected` state and
  puts it in the `WHERE` clause; a zero-row result means somebody got there first. The action path goes further
  and **claims the report before it punishes anybody**, rolling the claim back if the punishment fails: a card can
  sit on screen indefinitely and a modal for five minutes, so writing the state afterwards would only decide whose
  `case_id` survived -- both targets would already have been banned. Raised by both reviewers on #360.
- **The card's state is derived from the row every time it is rendered.** Legacy decided whether it was dismissing
  or restoring by comparing the button's own _label_ to the string `'Dismiss'` -- deriving state from the UI it had
  just rendered, which goes wrong the moment two moderators click at once.
- **Actioning is terminal.** Once a report has produced a case its Dismiss and Action buttons are disabled: the
  case is the record now, and live buttons would offer a second punishment for the same report. Legacy's `noop`
  action goes with it, since it set the state Dismiss already produces.
- **A dismissed report cannot be actioned either** (added after P5, on the owner's call). Dismissing is the
  decision that a report needs no punishment, so offering one beside it asks the moderator to contradict
  themselves in a single click. The way back is the same button, relabelled **Reopen** rather than legacy's
  "Restore": what comes back is the report's place in the queue, and reopening leaves its own mark on the row.
  Both the button and the select behind it re-check the state, because a card nobody has clicked since the
  state changed still carries live buttons.
- **Per-action permission gating on the card.** Legacy gated its report buttons on _nothing_. Handling a report at
  all needs ModerateMembers; the action then needs whatever Discord's equivalent command needs (KickMembers to
  kick, BanMembers to ban), because `setDefaultMemberPermissions` gates a command by name and cannot gate a
  "pick a punishment" select. Without this, ModerateMembers on the card would silently grant BanMembers.
- **The reason picker is one modal, not legacy's select-then-maybe-a-modal.** A select menu is a legal child of a
  modal `Label`, so the presets and the free-text box live in the same interaction -- which also means no pending
  report is held in a process-local collector that a restart or a second replica would lose. Both halves are
  joined when both are filled.
- **One report menu, not legacy's pair** (removed after P5, on the owner's call -- #394). P3 shipped a one-click
  `Report Message` beside `Report Message with Reason`, on the theory that forcing a reason picker in front of the
  fast path is how a report queue ends up empty. What the pair produced instead was two near-identical entries in
  a right-click menu and reports reading "No reason provided", which staff have to reconstruct from the message
  alone. The picker kept the name `Report Message` and is now the only way a member reports a message in a guild.
- **No timed ban in the action list**, for the same reason `/ban` had no duration: it needs P2's scheduler, and a
  tempban nothing lifts is a permanent ban that claims otherwise. (P2 has since added it -- as an optional
  duration on the Ban modal rather than a fifth option, since a tempban is a ban with an expiry, not a different
  punishment.) **Softban was ruled out at P3 and added after P5**, on the owner's call: the original reasoning
  was that bulk message deletion is not what a report about one message calls for, which is true of the report
  and not of the account behind it. A report is very often the first staff hear of somebody who has been posting
  the same thing in five channels, and softban is the one action that clears it. It takes no duration, and it is
  the one action whose failure mode had to be thought about again: a softban whose ban lands and whose unban
  does not leaves the target banned with a case filed, so the report stays closed rather than returning to the
  queue for the next moderator to ban somebody who already is.
- **Report cards go through `ActionExecutor`**, like the mod log and for the same reason: that seam is the
  invariant P7 audits.
- **The card links to the dashboard**, in the embed description rather than the footer -- Discord renders no
  markdown in a footer, the same finding `/history`'s link ran into at P1. The link is passed into
  `buildReportEmbed` rather than read from the context inside it, which is what keeps that a pure function of the
  row and unit-testable. `dashboardLinks.ts` owns every Discord→dashboard URL this bot builds, so the trailing
  slash `FRONTEND_URL` may or may not carry is dealt with once.
- **The detail view renders the reported content through `DiscordMarkdown`**, the renderer the ModMail thread view
  and the AMA/panel previews already use -- a reported message is Discord message content, and staff deciding a
  report should not be reading raw `<@1234…>`. The queue list stays plain truncated text, matching `ThreadsList`.
- **The dashboard queue is read-only, as specced.** Handling a report means warning or banning somebody, and that
  path already exists on the card with the hierarchy and permission checks the bot enforces; a second copy on the
  dashboard would be a second copy of those checks.

Feature 30's hook point is `fileReport` in `automoderator-bot/src/lib/reports.ts`: it takes a reporter plus an
optional message snapshot and owns no Discord side effect, so P5's filter can call it with the bot as the reporter.
No dead code was added for it -- the seam is simply the split between `fileReport` and `syncReportCard`, mirroring
`createCase`/`dispatchCaseLog`.

The seed script grew five reports and five preset reasons: a multi-reporter open report, a dismissed one, an
actioned one linked to a seeded case, an image-only report whose attachment url is already dead, and an
account-level one -- plus reported messages pointing at a channel that never existed, which is the
dangling-reference class the dashboard's views keep hitting.

---

### P3b — DM reporting

**A new feature, not a port.** Legacy had nothing like it, and it is the first thing in this product that needs the
website as more than a config surface.

The problem: someone is harassed in DMs and wants to report it to a server they share with the sender. Today the
only evidence is a screenshot, which staff have no reason to trust. A user-installed message context menu hands us
Discord's _own_ copy of the message in the interaction payload, which is forgery-proof by construction -- and needs
no Message Content intent, because the user explicitly invoked the command on it.

| Layer     | Work                                                                                                  | State |
| --------- | ----------------------------------------------------------------------------------------------------- | ----- |
| Schema    | `automoderator_report_messages` (messages 2..N of a draft, with their own author)                     | done  |
| API       | draft-token exchange, candidate-guild resolution, submission, card post; widened `sanitizeRedirectTo` | done  |
| Bot       | user-installable `Add to Report Draft` menu, `/submit-report`                                         | done  |
| Dashboard | public `/automoderator/report/<token>` confirmation page; `automoderator_report_prompts` CRUD         | done  |

**What landed with the schema + API pass (2026-08-18).** The report spine moved from
`services/automoderator-bot/src/lib/reports.ts` into `@chatsift/backend-core`'s `automoderatorReports.ts`, and
the card builders from the bot's `reportCard.ts` into `@chatsift/core`'s `automoderatorReportEmbeds.ts` -- both
because the API now files reports and posts cards too, which is the same arrangement `refreshCaseLog` already
has with the bot's `dispatchCaseLog`. `reportsTotal` stayed in the bot and is incremented from `fileReport`'s
`joined` flag, since `backend-core` has no Prometheus registry. Drafts live in Redis
(`automoderatorReportDrafts.ts`): a 30-minute draft renewed on every add, a 10-minute token, a six-message cap
that keeps the card inside Discord's 6000-character embed budget. Both routes set `allowScopedSession: false`
and are listed in `NON_GUILD_SCOPED_ROUTES` -- a `/dashboard`-minted session belongs to one guild's moderator
and must never redeem somebody's personal DM draft.

**Three invariants the pass had to settle that the design above didn't state.** The subject message is the
first message in the draft _authored by the target_, not simply the first -- the parent row's
`target_id`/`target_tag` describe whoever wrote the snapshot on it, so a draft opening with the reporter's own
reply would otherwise headline the report with a message the reporter wrote. Joining an existing report
_discards_ the joiner's context messages: letting a second reporter append to evidence staff are already
reading would rewrite it under a card that may have been acted on, and would let anyone who can guess a
reported message id splice their own text into someone else's report. And **a draft is bound to one channel** --
without that a reporter could take the subject from their DM with one account and the "context" from an
unrelated DM with somebody else, and that third party's private messages would be persisted onto a report about
the first and shown to a guild's staff, with nothing downstream able to catch it.

**Two things review caught that are worth not re-learning.** A user-installed context menu runs in
`PRIVATE_CHANNEL`, which covers **group DMs** -- so a draft can capture a participant who is neither the target
nor the reporter, and the card takes an explicit `reporterId` rather than labelling everyone who isn't the
target as the reporter. And the submission route **claims the draft token with an atomic `DEL` before filing**:
resolving the token without consuming it let two concurrent submissions file one draft into two different
guilds, which `fileReport` has no reason to refuse because it dedupes per guild. The claim is released on every
failure path so a refusal costs a retry rather than the draft.

**What landed with the bot + dashboard pass.** `Add to Report Draft` and `/submit-report` are registered with
`contexts: [PrivateChannel, BotDM]` and `integration_types: [UserInstall]`, which is what keeps the DM-only rule
true at the payload level rather than by a runtime check -- neither appears in a guild at all.
`services/automoderator-bot/src/lib/reportDraftFlow.ts` owns every line shown to a reporter, so the two commands
stay thin and the copy cannot drift between them. Two refusals are answered in the bot rather than left to the
website, because the reporter can still fix both from the DM they are standing in: a draft holding only their own
messages, and a draft with nothing in it.

The install prompt is **dashboard-managed**, not a slash command. It shipped first as `/report-prompt` storing
nothing, on the grounds that the message was identical for every guild -- which stopped being true the moment
the copy became editable, which is what staff actually want. It is now `automoderator_report_prompts`, shaped
exactly like `ticket_panels` (many per guild, `channel_id`/`message_id` so an edit rewrites the message in
place, a `prompt_json_data` snapshot) with structured-or-raw bodies like a ModMail panel and an AMA prompt.
Every structured field is optional and defaults from `@chatsift/core`'s `REPORT_PROMPT_DEFAULT_*`, so a guild
that names only a channel still gets the copy the feature was designed around -- and the dashboard form
prefills from those same constants, so what staff see before saving is what actually gets posted.

Two structural differences from a ticket panel are worth knowing. The button is a **link** to Discord's
user-install URL rather than a `custom_id`, so the message is inert once posted and nothing in the bot ever
routes an interaction back to it -- which is why this lives entirely in `services/api`. And the button is
appended server-side even in raw mode: a prompt without the install link looks fine and leads nowhere.
Creating one is refused outright when the guild has no reports channel, for the same reason the command was.

The confirmation page gates on `useMe()` before fetching rather than firing blind, so somebody who simply hasn't
logged in yet sees a login prompt instead of the "link expired" state. It collapses expired / already-used /
wrong-account into one message on purpose: the API distinguishes them and a reporter can act on none of the
differences.

**`automoderator_reports_total` is bot-intake only.** DM reports are filed by `services/api`, whose registry is
deliberately scoped to per-route HTTP metrics (#277), so they never reach `filed`/`joined` -- while their
resolutions _do_ count, because those go through the bot's card buttons. `dismissed + actioned` can therefore
exceed `filed`. Closing that means deciding whether the API's registry should carry domain counters at all.

**The flow.**

1. The reporter installs AutoModerator as a **user app** (`ApplicationIntegrationType.UserInstall`), which is what
   makes a context menu available inside a DM at all.
2. `Add message to report draft` -- contexts `PRIVATE_CHANNEL`/`BOT_DM` **only** -- appends the targeted message's
   snapshot to a Redis draft keyed to that reporter and replies ephemerally with how long they have and what to run
   next. Each addition renews the TTL.
3. `/submit-report` mints a token naming that draft and replies with a link to the website.
4. The page sends them through the normal Discord OAuth flow, then shows the snapshot back to them and asks which
   server the report is for.
5. Confirming files an ordinary report with `origin = 'DM'` into that guild's queue -- same card, same buttons, same
   action-to-case path P3 already built.

**Why the website hop is not a workaround.** It is the only fix for the thing that made this expensive in legacy
ModMail: answering "which guilds is this user in?" from a bot means iterating the bot's own guilds, because there is
no user→guild index. The OAuth `guilds` scope _is_ that index, and `services/api/src/routes/auth/discord.ts`
already requests it. The candidate set is then
`reporter's guilds ∩ bot:AUTOMODERATOR ∩ reports_channel_id IS NOT NULL` -- three cheap lookups -- and only the
survivors cost one `GET /guilds/{id}/members/{target}` each to confirm the target is there too. That is 0-5 calls in
practice, not thousands, and it goes through `services/discord-proxy` like everything else.

**Decisions already taken, so they don't get re-litigated:**

1. **Multi-message drafts, not one-shot.** A snapshot is forgery-proof but not context-proof: the reporter still
   chooses _which_ message, and a baited reply reads very differently alone. Accumulating lets them include their
   own side, and the card must say plainly that staff are seeing a reporter's selection out of a conversation they
   cannot see.
2. **The token is not a bearer credential.** It names a draft holding private DM content, so it is bound to the
   Discord user who minted it and checked against the session _after_ OAuth. This is deliberately a different
   security model from `automoderatorHistoryTokens.ts`, which _is_ a bearer token -- the resemblance is the trap.
3. **DM contexts only.** A user-installed message menu also fires in guilds the bot isn't in. Letting a message
   captured in guild A be filed into guild B would be a cross-server surveillance tool, which is a far larger
   product than this. In-guild reporting stays P3's separate, guild-installed menu.
4. **The candidate list is filtered to guilds the target is also in, and the copy is deliberately vague about why a
   server is missing** ("if they're a member, that community might not be accepting reports"). The vagueness is the
   mitigation: it stops the picker doubling as a membership oracle, because the reporter cannot tell "not a member"
   from "reports disabled".
5. **We do not re-host attachments.** Discord copies an embed image it is handed into the message it posts, so the
   card keeps the evidence alive past the original url's signature -- the same mechanism P3's card already relies on
   and the behaviour `discordAttachments.ts` documents. The exposure window is only between snapshot and
   confirmation.
6. **No rate limiting and no reporter blocklist.** Owner's call: guilds can deal with abusive reporters themselves,
   and a report costs a Redis write plus a message. Revisit only if load says otherwise.
7. **Message forwarding was considered and rejected.** Forwarding a DM into a bot DM would skip the install step
   entirely, but forwarded-message snapshots appear not to carry the original `author`, which destroys attribution
   -- the one thing the feature exists for.

**Where the extra messages live -- decided 2026-08-18.** An additive `automoderator_report_messages` child
table holds messages 2..N only; the parent's `message_id`/`message_content`/`message_image_url` stay the subject
message. Chosen over moving every message into the child table because the asymmetry is real rather than an
artifact: the subject is the message that dedupes and that the card leads with, while the rest are context the
reporter chose and therefore need `author_id`/`author_tag` (a draft can include the reporter's own replies),
which the parent never needs since its author is always the target. Moving message #1 down as well would also
leave its identity in two places -- the parent keeps `message_id` either way, because
`automoderator_reports_guild_id_message_id_idx` is load-bearing for both the "one report per message per guild,
for all time" rule and the race resolution in `fileReport` -- and would rewrite the working P3 surface for a
table that holds exactly one row for every guild report. Revisit only if P5's anti-spam filter hook starts
filing genuinely multi-message reports, at which point "one primary + context" stops describing the data.

**Accept knowingly:** staff can never independently corroborate a DM report. Every other report type has a jump
link; this one is trust in ChatSift's chain of custody, and the card should say so rather than let a moderator
assume otherwise.

**Operator prerequisite, in the same category as `AUTOMODERATOR_BOT_TOKEN`:** _User Install_ must be enabled for
the application in the Discord developer portal. Nothing in this repo can do that, and the context menu will not
appear in DMs until it is.

**Setup side.** Staff create a prompt in their server -- the same shape as a ModMail panel or an AMA submission
prompt -- with default copy explaining the flow and a link-type button pointing at the user-install URL. The
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

The message cache is the load-bearing part -- without it there is no "what did the deleted message say", which is the
whole feature. Size and TTL it deliberately and put both in config.

**Code-complete 2026-08-19, not yet exercised against the test guild.** Everything below describes what was
built and why; nothing here has been seen working on Discord, which is the one thing an agent cannot do. The
operator checklist in [Verification](#verification) is what closes that gap, and P4 should not be called done
until it has been run -- every earlier phase's "Shipped" line was written after that run, not before it.

**Deployment prerequisite, and the only one that can stop the bot booting: two privileged intents.**
`GuildMembers` and `MessageContent` must be enabled on the application in Discord's developer portal, or the
gateway rejects the IDENTIFY outright. Legacy AutoModerator held both, so the P9 cutover inherits them -- but a
fresh dev application does not. `MessageContent` is what makes the message cache hold text at all; `GuildMembers`
is what makes `GUILD_MEMBER_UPDATE` arrive.

What shipped, and where it deviates from the plan above:

- **The cache is sized in code, not in `ENV`.** `messageCache.ts` exports `MESSAGE_CACHE_TTL_MS` (24h) and
  `MESSAGE_CACHE_MAX_PER_CHANNEL` (5,000, legacy's number), both with their reasoning written next to them. An
  env var would be a deployment-wide knob nobody tunes per-deployment, which is a shape this codebase keeps
  rejecting. Both bounds matter and neither replaces the other: the per-channel cap is what
  holds under a raid, the TTL is what stops a quiet server's month-old text sitting in redis.
- **Delete attribution is a buffered gateway signal, not a per-delete REST fetch.** `auditObserver.ts` already
  subscribes to `GUILD_AUDIT_LOG_ENTRY_CREATE`, so `deleteAttribution.ts` reads MESSAGE_DELETE entries out of
  that stream into a 60-second in-process buffer keyed on (guild, channel, author). Legacy instead issued
  `GET /guilds/{id}/audit-logs` per deleted message -- a run of fifty deletions is fifty rate-limited
  requests -- and then compared the entry's `target_id` against the **message** id. `target_id` on a
  MESSAGE_DELETE entry is the _author_, so that comparison never matched: legacy's "Deleted by" footer was dead
  code for five years. The buffer is also more accurate, because Discord _aggregates_ repeated deletes by one
  moderator on one author in one channel into a single audit entry, so a run of them emits one event that has
  to cover every message in it. To be precise about what "a run" means here: this covers a moderator deleting
  messages one at a time, **not** Discord's own bulk delete, which arrives as `MESSAGE_DELETE_BULK` and is not
  observed at all (see below). A delete waits `ATTRIBUTION_GRACE_MS` (1.5s) before rendering, since the two
  gateway events can land in either order. The buffered entry is matched but never _consumed_, which is a
  knowing trade-off: within the window, a member deleting one of their own messages in a channel a moderator
  just cleaned up is credited to that moderator. Nothing can tell the two apart -- Discord files no audit entry
  for a self-delete -- and consuming the entry instead would abandon attribution partway through the purge it
  exists for, since the aggregation means one entry covers the whole burst.
- **The channel-tree walk is shared with Social.** `resolveChannelChain` moved from `social-bot`'s
  `discordCache.ts` into `@chatsift/bot-core` -- it is the same three-level lookup Social already used for
  per-category XP multipliers, down to the redis cache and its negative entries, so P4 reuses it rather than
  warming a second copy of the same data. Social's module keeps the export as a thin wrapper, so nothing on its
  side changed shape.
- **Exemptions match up the channel tree, three levels** (the channel, its parent, its parent's parent -- which is
  as deep as Discord goes: thread inside text channel inside category). One row on a category covers everything
  under it including threads that do not exist yet. Legacy resolved the same two levels but substituted a
  thread's parent for the thread itself before comparing, so exempting a thread by id did nothing at all. Parent
  resolution is a `GET /channels/{id}` behind a one-hour redis cache, and is skipped entirely for the
  overwhelming majority of guilds, which have no exemptions and short-circuit before touching Discord.
- **`sortChannels` stopped being a filter.** The exemption picker lists voice, stage and media channels, and
  none of them rendered: `@chatsift/discord-utils`'s `sortChannels` -- written for the dashboard's channel
  picker before text-in-voice existed -- dropped every non-text type before `ChannelSelect` could consult its
  own `allowedTypes`. It now sorts and no longer decides, so the caller's list is the only gate. **This was
  already breaking Social**, whose per-channel XP config has listed `GuildVoice`/`GuildStageVoice` since #343
  P4 with a comment explaining why, and silently could not offer them; Social's API never restricted the type,
  so that picker works now with no server change. Audited against every `ChannelSelect` call site: voice
  channels appear in exactly the two that ask for them (Social's XP config, these exemptions). The one other
  visible change is that media channels and their posts now appear in the pickers that allow threads, exactly
  as forum channels already did.
- **The table is keyed `(guild_id, channel_id)`**, where legacy's `log_ignores` was keyed on `channel_id` alone.
  Channel ids are globally unique so legacy worked, but it also meant a delete request naming another guild's
  channel would have removed that guild's row.
- **The user log covers display names too.** Legacy tracked `username` alone because `global_name` did not exist
  yet. Post-pomelo the display name is the one people actually see and the one impersonation uses, so all three
  (nickname, username, display name) are diffed, and several changes in one event post as several embeds in one
  message rather than as separate posts.
- **Profiles are cached on join and on change, and nothing else.** `GUILD_MEMBER_UPDATE` carries only the new
  state, so a diff needs a previous one; the consequence, which legacy had too, is that **the first change after
  a cold cache is recorded rather than logged**. Priming from message authors was considered and dropped: a
  `MESSAGE_CREATE` member object need not carry `nick`, so it would have manufactured false "cleared their
  nickname" entries. The cache lives in redis with a 30-day TTL, so this costs one change per member on first
  deploy rather than on every restart.
- **`MESSAGE_DELETE_BULK` is deliberately not logged.** Legacy did not either, and the honest rendering of a
  hundred-message purge is not a hundred embeds. P6's `/purge` files a case, which is the record that wants
  reading.
- **Log posts go through `ActionExecutor`** like every other Discord side effect, so a log post is counted and
  traced on the same axis as the ban that produced it.
- **Two metrics beyond the P4 plan**, both because the failure they catch is otherwise completely silent:
  `automoderator_feature_invocations_total{feature,outcome}` (the taxonomy's, finally written to) and
  `automoderator_message_cache_lookups_total{result}`. A flat-zero `hit` on the second one is what a missing
  `MessageContent` intent looks like: every message caches with empty text, every delete finds nothing worth
  saying, and nothing anywhere errors.

`caseLog.ts` kept its own dispatcher rather than folding into the new shared `guildLog.ts`: a case _rewrites_ the
message it already posted when it is amended, which needs `log_message_id` on the row and `wait: true` on the
first post. Every other log is fire-and-forget, and that is all `guildLog.ts` does.

No experiment gate. The message and user logs are opt-in by construction -- a guild with no webhook row for the
type gets nothing -- so the kill switch a gate would add already exists, per log, in the dashboard.

---

### P5 — Filters

The largest phase, and the only one split across more than one PR. Three, each shipping a filter that works end
to end rather than a layer that waits on the next one:

| PR  | Features                                                                      | State                    |
| --- | ----------------------------------------------------------------------------- | ------------------------ |
| P5a | **01** banword policy on native hits, **33** filter log, **10** bypass roles  | shipped (#365)           |
| P5b | **02** URL allowlist, **03** invite allowlist, **09** exemptions, `/simulate` | shipped (#367)           |
| P5c | **07** anti-spam, **11** trigger ladder + decay                               | open in #368, unverified |

**Feature 12 (DM on trigger) dissolved into P5a rather than being its own item.** A banword policy files a case,
and `applyModerationAction` already DMs the target for every case that carries a punishment -- so the feature is
delivered for free wherever there is a policy, and a hit with no policy has nothing to tell anyone about that
Discord's own block message hasn't already said. What remains of it is P5b's, and lands there: the URL and
invite runners delete a message without filing anything, so without a DM it would simply vanish unexplained.

#### Owner decisions taken at P5a

Recorded here for the same reason the top-level ones are -- so they don't get relitigated.

1. **Discord's AutoMod is read-only to us, permanently.** The API reads a guild's rules through the bot token
   (`listAutomodRules.ts`) and never writes one -- not from the dashboard, not from P9's migration. Reading still
   costs the bot **Manage Server**, which every AutoMod endpoint requires, so the permission bump happens either
   way and was not what the decision turned on.

   What it buys: a policy can only ever name a keyword the guild actually has, because the editor offers the
   rule's own entries rather than a text box. The failure this feature is most prone to -- a policy configured
   against a word no rule contains, which fires nothing and errors nowhere -- is unrepresentable.

   What it costs, knowingly: adding a banned word is a two-step job (add the keyword in Server Settings, then
   attach a policy), and a keyword removed on Discord's side leaves an orphaned policy. Orphans are rendered as
   orphans rather than deleted -- a rule can vanish because somebody deleted it _or_ because the read momentarily
   failed, and quietly destroying configured punishments on the strength of the second is the worse failure.

2. **Policy keys on `(rule_id, keyword)` with a nullable keyword**, not on `matched_keyword` alone as this doc
   originally specified. Null means "any hit on this rule", and keyword-level beats rule-level when both match.

   The original keying is right for a keyword rule and cannot express the other two kinds Discord has: a
   **preset** rule (Profanity / Sexual Content / Slurs) matches a word list we cannot enumerate, so there is no
   keyword for a policy to name at all, and a **regex** rule returns the pattern, which nobody wants to attach
   policies to one at a time. Rule-level keying alone would have coarsened policy and lost legacy's per-word
   model; having both covers strictly more than either, and lets a guild say "this whole list warns, except that
   one word, which bans".

3. **Feature 30 survives as a `REPORT` policy action.** The port moves the suppression decision into Discord's
   rule config (block versus alert) but keeps the report itself. The editor offers REPORT only when the rule
   alerts rather than blocks, because a blocked message never existed and there is nothing for the card to link
   to. The bot degrades rather than breaking if a rule is switched to blocking afterwards: it files an
   account-level report, which the report spine already supports.

4. **The trigger ladder counts URL, invite and anti-spam hits -- not banword hits.** A banword policy already
   carries its own punishment, so counting it too would stack a ladder action on top of a ban. Legacy counted
   anti-spam alone; this widens it to the two runners that otherwise only delete and DM.

#### P5a — what shipped

| Layer     | Work                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_banword_policies`, `automoderator_bypass_roles`                                             |
| API       | policy CRUD, bypass-role CRUD, AutoMod rule **read**, `FILTER` becomes a writable log type                 |
| Bot       | `AUTO_MODERATION_ACTION_EXECUTION` response layer, bypass resolution, filter log dispatch, rule-name cache |
| Dashboard | Banned Words (rules + policies), Bypass Roles, `FILTER` in the log-channel picker                          |

Two things landed alongside it that are not features:

- **Idempotency keys reached `applyModerationAction`.** The automod path both punishes _and_ files, and a
  redelivered dispatch after a gateway resume would otherwise do both twice. A pre-flight lookup covers the
  duplicate Discord call; the partial unique index still covers the duplicate row. A _blocked_ message carries
  no id to key on, so that case is knowingly unprotected -- every alternative key would suppress a genuine repeat
  offence.
- **Duration parsing moved to `apps/website/src/utils/duration.ts`**, shared by the warn ladder and the policy
  editor. The text these functions produce is fed straight back through the parser next time the form opens, so
  two copies disagreeing by a rounding rule would silently change a saved duration.

#### P5b — what shipped

| Layer     | Work                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_allowed_urls`, `automoderator_allowed_invites`, `automoderator_filter_exemptions`, two settings toggles |
| API       | allowlist CRUD (both), exemption CRUD, `useUrlFilters`/`useInviteFilters` on the config route                          |
| Bot       | `filterRunner.ts` pipeline over `MESSAGE_CREATE`/`MESSAGE_UPDATE`, URL and invite runners, DM on trigger, `/simulate`  |
| Dashboard | URL Filter, Invite Filter and Filter Exemptions pages                                                                  |

Feature 33 renders **both** native AutoMod hits and our own runner hits into one filter log, so staff read one
place. That's the reshape. P5a built the embed and the dispatcher; P5b's runners write into the same one.

##### Owner decisions and deviations taken at P5b

Recorded so they don't get relitigated, same as P5a's.

1. **The URL matcher requires a scheme, and `tlds.txt` is dropped entirely.** This doc previously called the
   IANA list "a standing maintenance item"; it is not coming across, and there is nothing to maintain. Legacy
   fetched it at Docker build time (a `wget` in its Dockerfile -- the file was never in the repo) and used it to
   decide whether a _scheme-prefixed_ link's TLD was real. With the scheme required, that check buys almost
   nothing: `https://` in front of a string is what makes it a link, whatever the TLD.

   The alternative considered and rejected was schemeless matching, which is what would have justified the
   list: it catches `evil.com` pasted without a scheme, the obvious evasion legacy missed. It also deletes "I
   rewrote it in node.js" and "nice, thanks.lol", because `.lol` is a real TLD. The owner's call was to keep
   legacy's behaviour -- a filter that misses an evasion beats one that eats ordinary sentences, and the invite
   filter (which _is_ schemeless, safely, because `discord.gg` is unambiguous) covers the case people actually
   care about.

2. **Allowlist matching is suffix-on-label-boundary, not legacy's last-two-labels reduction.** `example.com`
   covers `cdn.example.com` and does not cover `notexample.com`. Legacy reduced both sides to their final two
   labels before comparing, which broke `example.co.uk` in both directions at once: the site could not be
   allowlisted, and allowlisting its reduction (`co.uk`) would have opened every `.co.uk` domain there is.
   Suffix matching gets that right with no public-suffix list, which is the other reason it wins.

3. **Exemptions are a `(guild, channel, filter)` child table with an enum, not the bitfield this doc
   specified.** There is no bitfield anywhere else in this schema, and adding one means an encoding the API and
   the bot have to agree on out of band. The enum is greppable, readable in psql, and lets the lookup be a
   plain `WHERE filter = …` against an index. `automoderator_filter_kind` carries `ANTISPAM` already -- the same
   ahead-of-the-code shape `automoderator_log_type` used -- and the API's `WRITABLE_FILTER_KINDS` is what gates
   it out until P5c. `words` did not survive: Discord's own per-rule channel exemptions are the right place to
   stop a native match happening at all, and `files`/`global` went with dropped features 05 and 04.

   **This is the one P5b decision the owner left open rather than closed** ("simpler for now, we can maybe get
   back to it later"). It is not a stopgap -- the child table is correct and can stay indefinitely -- but if it is
   revisited, the thing that would justify a bitfield is a filter count high enough that a row per (channel,
   filter) stops being trivial, which three kinds is nowhere near. Revisit on that evidence, not on taste.

4. **Exemptions and bypass roles short-circuit _before_ the runners, and are recorded as decision traces rather
   than filter-log lines.** This is the one place P5b's runners differ from P5a's native path, which does post a
   "skipped, this role bypasses" line. A native hit arrives with Discord's matching already done and paid for,
   so saying so costs nothing; here the match is ours to make, and making it purely to announce that we are
   about to ignore it would spend an invite resolution on every staff message. `traceDecision` still answers
   "why wasn't this deleted" -- that is what it is for.

5. **The invite allowlist stores a name snapshot**, the only place this schema does. Everywhere else the
   dashboard resolves ids against guild data it already loads, so a snapshot would only go stale. It cannot
   here: the allowlist names servers this bot is _not_ in, so nothing can look them up afterwards, and a list of
   bare snowflakes is one a manager has no way to audit. Rendered as "the name when it was added"; re-adding the
   server is what refreshes it. Entries are added by pasting an invite, resolved to the guild id at write time
   through the bot's own REST client -- which preserves legacy's 2021 fix against vanity URLs and drops the
   Cloudflare worker legacy resolved through.

6. **A guild's own invites are always allowed, without a row.** Legacy made every server allowlist itself,
   which every server had to do and none expected to.

7. **The URL filter never judges an invite link.** Added after P5b shipped, on the owner's call. Any
   scheme-required matcher reads `https://discord.gg/x` as a link to `discord.gg`, so with both filters on the
   URL filter deleted the invites the invite filter had just allowed: a partner server's, and the guild's own,
   which decision 6 above allows without a row precisely because nobody thinks to allowlist themselves. The
   dashboard already told guilds invites were the invite filter's business; the code did not. `extractLinkedHosts`
   now skips whatever the invite matcher claims, per match rather than per host, so an ordinary
   `discord.com/channels/...` link is still an ordinary link. The accepted cost, weighed against always deferring
   only when the invite filter is on: a guild running the URL filter alone stops catching invites entirely, and
   turning the invite filter on is what covers them. The coupling that the conditional version would have
   introduced, where one filter's toggle quietly changes another's behaviour, was judged worse than the hole.

8. **`/simulate` evaluates as a member holding no bypass roles**, and says so in its reply. Anyone with
   permission to run it necessarily holds the roles that would let them off, so passing their own would make the
   command answer "nothing, you're staff" every time. It calls `evaluateFilters` -- the same function the runner
   calls, not a copy of it.

#### P5c — what it delivers

| Layer     | Work                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| Schema    | `automoderator_trigger_counts`, `automoderator_trigger_punishments`, three settings columns                         |
| API       | trigger-ladder CRUD, `antispamAmount`/`antispamTime`/`triggerDecayMinutes` on the config route, `ANTISPAM` writable |
| Bot       | anti-spam runner, trigger ladder, decay sweep                                                                       |
| Dashboard | Filter Ladder (rungs + decay), Anti-Spam, `ANTISPAM` in the exemption picker                                        |

The anti-spam runner slots into `filterRunner.ts` as a third entry in its `RUNNERS` map plus an `ANTISPAM` entry
in `FILTER_KIND`, as planned; widening `WRITABLE_FILTER_KINDS` in `services/api`'s `automoderator/schemas.ts` is
what exposed it to the exemption picker.

##### Owner decisions and deviations taken at P5c

1. **Anti-spam has no on/off flag -- the thresholds are the setting.** This is the one place P5c deliberately
   breaks the shape P5b established with `use_url_filters` / `use_invite_filters`. Those flags earn their place
   because an empty allowlist is a coherent, strict configuration ("no links at all") that inferring the toggle
   would make unexpressable. Anti-spam has no equivalent: "on, no threshold" is not a state a guild can mean.
   Both columns set is what turns it on, both null is off, and
   `automoderator_guild_settings_antispam_check` makes a half-set row impossible so nothing downstream has to
   handle one. The API rejects a PATCH carrying only one of the pair rather than validating against a value it
   cannot see.

2. **The trigger ladder is its own table and its own enum**, not a discriminator column on
   `automoderator_warn_punishments`. The rows are near-identical, but the two ladders count different things
   and a guild sets them independently, so merging them would make every ladder read filter on a discriminator
   for no gain. The enum gains `WARN` over the warn ladder's three values, which is the whole reason it is a
   separate type: the first rung most guilds actually want is "warn them", and that warn then counts toward the
   _warn_ ladder -- legacy's escalation path, and the one guilds expect.

3. **One trigger per message, not per filter -- and once per message _ever_.** A message carrying both a
   forbidden link and a forbidden invite is one thing the member did; counting it twice pushes them up the
   ladder at double speed for a single post. The first half is structural (one ladder call per message); the
   second is a redis `SET NX PX` claim on the message id, and it exists because the filters deliberately re-run
   on `MESSAGE_UPDATE`. Normally the message is deleted on its first hit so no edit can follow -- but a message
   the bot _could not_ delete survives, and without the claim every later edit that still trips a filter is a
   fresh rung. A member fixing three typos on a message that still carries a
   forbidden link should not climb three. Banword hits are still never counted, per P5a's decision 4, and that
   too is structural: the ladder lives in the filter pipeline and native AutoMod hits arrive on a different path
   entirely.

   The same claim covers a gateway redelivery, which is the other way one message reaches the pipeline twice.

4. **A failed delete does not escalate.** `deleteMessages` returns `'failed'` when the bot lacks Manage Messages
   or a bulk delete is refused, and the ladder is skipped for that outcome -- banning somebody over messages
   everyone can still read, without even the DM this path already suppresses for the same reason, is the worse
   of the two failures. The filter log's line for that outcome names the missing permission, which is the part
   staff can act on.

5. **Nothing is written to `automoderator_trigger_counts` for a guild with no ladder.** An `EXISTS` on
   `automoderator_trigger_punishments` inside the insert is what keeps this from being a table that only grows:
   a guild running the filters with no rungs _and_ no decay would otherwise accumulate a permanent row per
   offending member forever, feeding a ladder that does not exist -- which is exactly what the table's own schema
   comment claims the design avoids, and it was only true when decay was on. Configuring a ladder later starts
   everyone from zero, which is the only honest answer: hits that were never recorded cannot be counted
   retroactively, and legacy could not either.

6. **The burst carries its channels, so anti-spam does not depend on the message cache.** Legacy stored bare
   message ids in redis and looked each one up in its cache to find the channel to delete from -- which made
   anti-spam quietly dependent on a cache that can miss, and (without the `MessageContent` intent) misses
   silently. The sorted-set member here is `channelId/messageId`, so the burst is self-describing. The whole
   burst is deleted, grouped per channel, bulk where there is more than one.

   **The window is a Lua script, not five round trips**, because the multi-replica case the sorted set exists
   for is the one five round trips get wrong. A member's messages are spread across shards by channel, so two
   replicas can each hold half a burst; with the read and the clear apart, both can observe a set at or above
   the threshold before either `DEL` lands, and one flood becomes two delete passes, two DMs and two rungs.
   `MULTI` cannot fix it -- the clear is conditional on the count, and a transaction cannot branch on a reply it
   has not received. Verified against a real redis: two invocations crossing the threshold concurrently, exactly
   one gets the burst.

7. **Only a new message counts toward anti-spam; edits do not.** The content filters still re-run on edits --
   that is the evasion they close -- but feeding edits into the rate window would mute somebody for fixing three
   typos.

8. **`/simulate` reports anti-spam without simulating it.** It is the one filter that decides on a rate rather
   than on content, so there is nothing about a pasted string to evaluate: running it would either record the
   simulated message into the member's real window or answer a question about how fast the moderator has been
   typing. The command says which it is doing, because "on, not simulated" and "nothing matched" are different
   answers and only one of them is true.

9. **The decay is one statement with a compare-and-swap, and it catches up.** Legacy's was broken three ways,
   none reproduced: it compared `new Date().getMinutes()` against `updatedAt.getMinutes()` (minute-of-hour, so
   it fired almost at random); its per-guild cooldown cache was inverted, so the first trigger row for a guild
   was deleted rather than decayed; and it decayed `automod_triggers` while the anti-spam runner incremented
   `filter_triggers`, so the counter that actually fed punishments never decayed at all. There is one table
   here, the comparison is on timestamps, and the decrement is `floor(elapsed / period)` rather than a flat one
   -- which is what makes the sweep interval and the guild's decay period independent. `c.count = d.count AND
c.updated_at = d.updated_at` is what makes it safe on several replicas with no lease, the same job
   `pardoned_by IS NULL` does in the auto-pardon sweep.

10. **A latent bug in the two existing punishment CHECKs was closed at the same time.**
    `automoderator_warn_punishments` and `automoderator_banword_policies` both wrote their MUTE arm as
    `duration_seconds >= 1`, which is _unknown_ for a NULL -- and a CHECK passes on unknown. Both accepted
    exactly the row their comments said they rejected. Every dashboard write goes through zod, which catches it,
    so nothing was ever wrong in practice; **P9's migration is the write path that does not**, which is what
    makes this worth fixing before P9 rather than after. All three constraints now spell the arm
    `duration_seconds IS NOT NULL AND duration_seconds >= 1`. No row in the dev database violated the tightened
    version.

#### Filter immunity, added after P5

The owner of a live guild was flagged by anti-spam. Nothing was wrong with anti-spam: bypass roles were the
only exemption the pipeline had, so staff and the owner were ordinary members to it. Two things followed from
that, and only the first is a preference.

**Discord refuses every punishment against a guild owner.** A trigger ladder rung on one is a guaranteed
failure, and the failure was not contained: `applyModerationAction` threw, the throw unwound past the filter
log dispatch, and the result was a member whose messages had been deleted and who had been DMed about it, with
no record of any of it anywhere staff could see. `permissions.ts` had encoded "You cannot action the server
owner" since P1, but only for the commands.

**The owner, Administrator, and Manage Messages are now immune to every filter**, on the owner's call, above
the guild's own configuration. Bypass roles keep the job they are good at: naming somebody who is not staff and
should still be left alone. The decisions inside that:

1. **Guild-level permissions, no channel overwrites.** Resolving overwrites means a channel read (and a
   thread's parent) on the path that runs for every message, to catch the moderator whose Manage Messages comes
   from an overwrite rather than a role. That moderator can be given a bypass role.
2. **One cached `GET /guilds/{id}` per guild**, five minutes, process-local, exactly the shape
   `automodRules.ts` uses. A failure is cached for one minute and **fails open**, matching the bypass check: a
   guild that cannot be read must not silently exempt everybody.
3. **The native AutoMod path gets the same gate.** Discord has already blocked the message by then, so what is
   skipped there is the punishment, which for an owner is one Discord would refuse anyway.
4. **A ladder rung that Discord refuses no longer eats the filter log.** The remaining case is a target above
   the bot in the role hierarchy; the log now says the escalation could not be carried out, next to the line
   that already says so for a delete.
5. **`/simulate` still evaluates as an ordinary member**, and its reply says it: an author with the permission
   to run it necessarily holds the ones that would exempt them.

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
unanswerable -- recommend it does.

---

### P7 — Hardening

No new features. Backfill: unit-test coverage on the pure logic (ladder arithmetic, exemption resolution, purge
filtering, keyword→policy mapping), decision-trace review, metric review against a real week of dev traffic, load
sanity on the message cache, and a pass over every `ActionExecutor` call site confirming nothing bypasses it.

---

### P8 — Horizontal scaling opt-in

**No longer blocked** -- the mechanism shipped, see [12-horizontal-scaling.md](12-horizontal-scaling.md). This
phase is now genuinely just configuration, provided the invariants below were held from P0:

- Add `AUTOMODERATOR_SHARDS_PER_REPLICA` to `.env.public` and map it onto the service's `SHARDS_PER_REPLICA` in
  `docker-compose.yml`, following the three existing bot blocks.
- Add a `plan_scale automoderator-bot AUTOMODERATOR_BOT_TOKEN AUTOMODERATOR_SHARDS_PER_REPLICA` line to `./compose`.
- Audit every DB-driven timer this port adds for `ownsShardForGuild`. Neither of P2's two sweeps needs it -- they
  claim their rows before acting -- but anything that reads rows and then acts on Discord does.

The bot itself needs no code change to opt in: `createBotGateway` claims a slot on every boot regardless.

---

### P9 — Migration and cutover

Legacy data migration + drain. Follows the Social precedent
([10-social-port.md](10-social-port.md) while it still exists, then `01-architecture.md`):

- **Reuse the legacy application's token** so no guild has to re-invite -- and clear its existing global commands with
  a bulk `PUT []` first, or `bot-core`'s Ready-time `/deploy` bootstrap never fires and no commands register. This
  trap cost Social nothing only because it was caught in advance.
- **Run the migration inside the running `api` container**, not from a host checkout -- same image, so it has the
  compiled script and inherits prod `IS_PRODUCTION` / `DATABASE_URL_PROD`.
- Migrate: cases (with their numbering intact), allowlists, ladders, log-channel webhooks, settings.
  **Do not migrate:** self-assignable roles, mute roles, malicious URL/file lists, NSFW thresholds, mention
  config, blank-avatar and forbidden-name settings, **banned words and their policies** (see below -- the policy
  half cannot survive without the matching half it was attached to).
- **Ladder durations change unit and gain a ceiling.** Legacy's `warn_punishments.duration` is unbounded
  milliseconds in a `BIGINT`; the new column is seconds in an `INTEGER`. A migrated MUTE rung longer than
  `MAX_TIMEOUT_SECONDS` has to be **clamped by the migration**, because nothing at runtime clamps it -- that is
  P2's stated invariant, and a rung Discord refuses is a rung that silently never fires. A legacy MUTE rung with
  no duration at all can't be represented either (the CHECK forbids it) and was already inert in legacy; drop it
  and report the count.
- **Banned words do not migrate at all**, which is an owner decision taken at P5a and a reversal of what this
  section used to say. Legacy rows carry both matching _and_ policy; the matching half can only live in a native
  AutoMod rule, and creating those rules would mean writing to Discord's AutoMod, which this port has settled it
  never does (see [P5](#p5--filters)). Rather than hold one exception open for one migration, each community
  rebuilds its keyword lists in Server Settings after cutover and attaches policies to them -- the bot is changing
  radically enough that reviewing a years-old word list is worth doing anyway. `banned_words` is therefore in the
  **do not migrate** list above, and the guilds-over-the-native-limits question it used to raise disappears with
  it. Say so in the cutover notice, not on the day.
- Verify with two scratch databases, offset sequences, id-independent diff.
- Then tear down: legacy compose stack, then `postgres-old`. Its ingress is no longer separate -- since #305 the
  `interactions.`/`logs.` routes are two blocks in `build/caddy/Caddyfile`, and the `legacy` external network in
  `docker-compose.yml` exists only to reach them. All three go in the same commit; nothing else uses that network.

## Scaling readiness

AutoModerator is the largest and most compute-heavy bot, so it's the intended first opt-in. The mechanism is
bot-core's to define; these are the invariants this codebase holds from P0 so that opting in is configuration rather
than a rewrite.

1. **No process-local state that must be globally consistent.** Anti-spam windows and trigger counts live in Redis
   and Postgres respectively -- never in a module-level `Map`. The one existing process-local primitive,
   `withQueueLock`, is fine for per-guild-user ordering within a replica and must not be relied on for anything a
   second replica could also be doing.
2. **Everything gateway-driven is idempotent.** Redelivery after a reconnect is normal. Case creation, report filing
   and ladder increments all take an idempotency key.
3. **The scheduler claims rather than reads.** Both sweeps write their claim before acting, from P2 -- the expiry
   one under `FOR UPDATE SKIP LOCKED`, the auto-pardon one as a compare-and-swap on `pardoned_by` -- so N replicas
   is safe by construction rather than by leader election, and neither needs `ownsShardForGuild`.
4. **Read-modify-write paths are enumerated and lock-ready.** Ladder counting, report dedupe and case-number
   allocation are the three. Case numbers are already database-allocated.

   **Narrowed once the mechanism landed** ([12-horizontal-scaling.md](12-horizontal-scaling.md)): the other two do
   _not_ automatically need a Redis lock. A guild maps to exactly one shard owned by exactly one replica, so
   `withGuildUserLock` still serializes every guild-scoped gateway event and interaction for a guild+user pair,
   exactly as it does today -- and DMs always arrive on shard 0. What genuinely needs a distributed lock is
   narrower: state `services/api` also mutates, and anything keyed on something other than a guild. Check which
   category a call site is in rather than assuming the broad version.

5. **Metrics are replica-safe.** No metric assumes a single process; the scrape config gains per-replica targets
   rather than the code aggregating.

## What to watch in the logs

The diagnosability bias that applied to Social applies harder here -- this bot bans people.

- `automoderator_automod_events_total` flat at zero for a guild that has banword policies configured means the
  hybrid is broken for that guild: either no native rules exist, or the intent isn't granted. This is the failure
  mode most likely to be silent.
- `automoderator_scheduler_lag_seconds{type="expiry"}` climbing means tempbans aren't expiring -- the classic "why
  is this user still banned" report. Since P2 gives up on nothing, a stuck expiry retries every tick, so a
  single row that can never be lifted shows here as a lag figure that keeps growing rather than as silence.
  `automoderator_scheduler_tasks_total{result="failed"}` alongside it says how many, and the error log says why.
- `automoderator_reports_total{state="filed"}` climbing with neither `dismissed` nor `actioned` following it means
  a guild's queue is filling up and nobody is reading it -- which is the failure mode a report queue has that a
  mod log doesn't.
- `automoderator_log_dispatch_total{result="failed"}` means webhooks are 404ing; legacy self-healed by deleting the
  row, so a spike here is usually a deleted log channel, not an outage.
- `automoderator_message_cache_lookups_total{result="hit"}` flat at zero while `miss` climbs means the message log
  is receiving deletes and has nothing to say about any of them -- almost always the `MessageContent` intent not
  being granted on the application. Nothing errors in that state, which is the whole reason this counter exists.
  `automoderator_feature_invocations_total{feature="message_log",outcome="skipped"}` is the same signal one level
  up, and separates it from an exemption doing its job only when read alongside the decision traces.
- Decision traces are the first thing to read for "why did/didn't the filter fire" -- they carry the exemption and
  bypass evaluation, which outcome-only logs never did.

## Verification

Per [workflow.md](../workflow.md#verification-standard). Agent side: `yarn build`, `yarn lint`, `yarn test`,
`yarn format:check`; unit tests on pure logic; new API routes confirmed mounted (401, not 404); migration scripts
diffed against scratch databases.

Operator side, per phase, against the test guild:

- **P1** -- each mod command files a correct case; case edit rewrites the log embed in place; a ban issued through the
  Discord UI still produces a case with the right moderator attached.
- **P2** -- a tempban actually expires and files its UNBAN case; `/unban` on an outstanding tempban stops the
  sweep lifting it a second time (as does an unban through Discord's own UI); `/case duration` re-times both a
  ban and a mute; a warn ladder step fires at the configured count and the moderator's reply says so; auto-pardon
  pardons a warn and rewrites its log embed. The seed script plants a due tempban and a 400-day-old warn so both
  sweeps have work on the first tick rather than needing anyone to wait.
- **P3** -- the report menu; dedupe across two reporters; dismiss/restore; action → modal → case.
- **P3b** -- install the user app, add two DM messages to a draft, submit, and confirm the picker lists only
  servers you and the sender share that accept reports; then confirm the filed report's card carries no jump
  link and its action path still produces a case.
- **P4** -- edit and delete logs carry old content; a moderator deleting somebody else's message is named in the
  footer while a self-delete is not; exemptions suppress, including a category covering a thread under it. Then
  three separate profile changes, because they are three separate diffs and only one of them existed in legacy:
  change a **nickname** only, a **username** only, and a **display name** only, and confirm each appears in the
  user log naming the right field. Needs both privileged intents granted --
  `automoderator_message_cache_lookups_total` staying at zero `hit` is the tell that `MessageContent` is not.
- **P5** -- trip a native rule and confirm the policy applies; each custom filter fires and is exempted correctly;
  bypass roles bypass; `/simulate` matches live behaviour.
- **P6** -- each purge filter; join-age kick; invite lookup.
- **P9** -- the full migration reconciliation, then a real guild's cases visible and correct on the new stack.

Every one of these ends in a real Discord action, so run them in a throwaway test guild -- there is no observe-only
mode to rehearse them behind.
