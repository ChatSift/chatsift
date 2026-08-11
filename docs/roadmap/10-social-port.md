# #343 — Social port (leveling + social interactions)

**Tracking issue:** #343 (to be created — this doc is referenced from it, not the other way around). **Depends on:**
nothing in flight — M4's AMA cutover ([05-migration-cutover.md](05-migration-cutover.md)) and M5's ModMail data migration
([06-modmail-port.md](06-modmail-port.md)) are independent of this and neither blocks nor is blocked by it. **Live
production impact:** none until P6 (cutover) — everything before that is additive: new tables, new service, new routes,
new dashboard pages. Legacy `ChatSift/Social` keeps running untouched the whole time.

## Status: P1 (schema) and P2 (API) done — P3 onward not started

`10-` is the next free roadmap slot. This doc follows the established lifecycle
([09-appeals.md](09-appeals.md) explains it): when the phases land, it gets **deleted** and its durable shape is condensed
into a new `## 11. Social bot subsystem` section of [01-architecture.md](01-architecture.md) (the next free section
number there), with any operator runbook material (cutover steps, interaction-command resync) going to
[workflow.md](../workflow.md).

Owner decisions already made (2026-08-11), recorded so they don't get re-litigated:

1. **Redesign where warranted** — parity is the baseline, but known warts are in-scope redesign targets (the ModMail
   precedent). The [Redesign ledger](#redesign-ledger) below is the exhaustive list; anything not on it is a straight port.
2. **Social interactions make the cut** — both feature clusters (leveling _and_ custom interaction commands) are ported.
3. **Real data migration** — users keep their XP and levels. ModMail-style script + `--verify` + freeze window, not a
   drain-and-swap (XP is accumulated state; it cannot "drain").
4. **Issue-tracked, no milestone** — like appeals (#232), this is a tracking issue + this doc. No calendar commitments;
   the dates in M4/M5 were public announcements, and nothing here has been announced.

## What Social is

`ChatSift/Social` (separate repo, same situation `ChatSift/AMA` and `ChatSift/ModMail` were in) is the **leveling bot**:
users gain XP by sending messages, level up along a configurable curve, and earn role rewards. A second cluster,
**social interactions**, lets guilds define custom slash commands (`/hug`-style) with templated content.

It runs in production today: `stack/docker-compose.social.yml`, image `chatsift/social:latest`, database
`postgres-old`/`social`, Redis db 1, deployed via that repo's `deploy.yml` → DockerHub. Last real commit 2025-09-22
(a bug fix); functionally frozen since. It's on the full old stack this monorepo already left behind — Prisma,
tsyringe, class-based discord.js framework, yarn 3, and a `packages/api` that served the old `chatsift/dashboard`
(the API is **not** part of what gets ported; its route list only informs the new config surface).

### Feature catalog (from source, captured 2026-08-11)

**Leveling engine** (`packages/bot/src/events/tracking/messageCreate.ts`) — on every guild message from a non-bot:

- **Gate:** guild must be configured — `GuildSettings` row exists with `requiredMessages`, `requiredMessagesTimespan`,
  and `xpGain` all non-null. Otherwise the bot is fully inert in that guild.
- **Ignores:** per-user `ignored` flag; per-channel `ignored` flag, resolved against the message channel **or its parent
  category or, for threads, the thread parent's parent** — one `Channel` row can silence/boost a whole category, and
  threads inherit from their parent channel's config.
- **Eligibility (Redis rolling window):** a user must send `requiredMessages` messages within
  `requiredMessagesTimespan` seconds to gain XP once. Implemented with two keys in Redis:
  `leveling_tracking:<guildId>:<userId>` (a sorted set of message ids scored by timestamp; trimmed of entries older
  than 10 minutes, TTL of timespan+5s or 300s) and `leveling_ineligible:<guildId>:<userId>` (a cooldown key whose TTL is
  the _remainder_ of the window, computed from the first message's snowflake timestamp, so the window genuinely rolls).
  `requiredMessages <= 1` short-circuits all of this. This logic is subtle, battle-tested, and ports near-verbatim.
- **XP grant:** `xpGain × (channel multiplier ?? 1) × ∏(role multipliers)` — channel multiplier resolved through the
  same channel→category→thread-grandparent walk; role multipliers are multiplicative across all of the member's
  configured roles.
- **XP curve:** total XP required for level _n_ is `requiredXpBase + requiredXpMultiplier · n(n−1)/2`
  (`packages/bot/src/util/calculateLevel.ts` — closed form of the triangular-number series, the owner's own derivation,
  see https://didinele.me/blog/math-journey). Keep this formula _exactly_: any change silently re-levels every migrated
  user. `calculateUserLevel` walks levels upward until XP falls short (O(level), fine at real magnitudes).
- **Role rewards:** `Reward` rows are (roleId, guildId, level, clean). On each message the bot re-derives the member's
  full role set: all non-`clean` rewards at or below their level, the _highest_ `clean` reward only (tiered roles that
  replace each other), whatever they just earned, plus all their unrelated and managed roles — then calls
  `member.roles.set()`. This rebuild-the-world approach is a known wart with a bug-history TODO in the source; see
  redesign ledger item 2. A failure "bars" the user from role updates for 3 minutes in-memory (the 2025-09-22 fix —
  previously a single failure barred the _entire guild_ until restart).
- **Level-up notifications:** fires when the grant crosses the next level's threshold. Modes `None`/`DM`/`Channel`
  (message channel first, then a configured fallback channel; a dead fallback auto-nulls itself in the DB). Message is
  templated (`{{ username }}`, `{{ level }}`, `{{ guildName }}`, `{{ earnedRewards }}`) with a sensible default.

**Commands** (all guild-only): `/level [user]` (level, total XP, progress to next, current/next rewards — the only
read surface users have), `/config` (admin; sets all `GuildSettings` fields with bounds: required-messages 1–15,
timespan 1–60s, xp-gain ≥1, required-xp-base 1–500, required-xp-multiplier 1–100), `/channel ignore|unignore|list-ignored|set-multiplier`
(multiplier 1–10; accepts categories, text, forum, voice, public threads), `/role list|set-multiplier`,
`/reward create|delete|list` (create is an upsert per role), `/interaction create|delete|list`.

**Social interactions** (`SocialInteraction` model + `CommandHandler.handleCommand` fallback): `/interaction create`
registers a **real per-guild Discord slash command** named after the interaction and stores its `commandId`. When an
unrecognized command comes in, the handler looks up `(guildId, commandId)` and renders the stored content — templated
with `{{ author }}` and `{{ targets }}` (user-mention options, present when `allowTargets`), as plain content or an
embed (`color`, `attachmentUrl` as embed image, `plainContent` outside the embed), incrementing a `uses` counter.
Delete removes the guild command too. This is ModMail snippets' `commandId` situation again, and the same lesson
applies — see redesign ledger item 3.

## Old schema (migration source)

From `ChatSift/Social`'s `prisma/schema.prisma` (captured 2026-08-11), verbatim:

```prisma
enum LevelUpNotificationMode {
  None
  DM
  Channel
}

model GuildSettings {
  guildId                              String                  @id
  requiredMessages                     Int?
  // Stored in seconds
  requiredMessagesTimespan             Int?
  xpGain                               Int?
  requiredXpBase                       Int?
  requiredXpMultiplier                 Int?
  levelUpNotificationMode              LevelUpNotificationMode @default(None)
  levelUpNotificationFallbackChannelId String?
  levelUpNotificationMessage           String?
}

// Leveling
model Reward {
  roleId  String
  guildId String
  level   Int
  clean   Boolean @default(false)

  @@id([roleId, guildId])
}

model User {
  userId  String
  guildId String
  // Total XP the user has. Has no regard to level calculations or anything of the sort
  xp      Int     @default(0)
  ignored Boolean @default(false)

  @@id([userId, guildId])
}

model Channel {
  channelId  String
  guildId    String
  ignored    Boolean @default(false)
  multiplier Int?    @default(1)

  @@id([channelId, guildId])
}

model Role {
  roleId     String
  guildId    String
  multiplier Int?   @default(1)

  @@id([roleId, guildId])
}

// Interactions
model SocialInteraction {
  guildId       String
  commandId     String
  name          String
  content       String
  color         String?
  plainContent  String?
  attachmentUrl String?
  uses          Int     @default(0)
  embed         Boolean @default(false)
  allowTargets  Boolean @default(false)

  @@id([guildId, name])
}
```

Six models, **every primary key a natural composite of snowflakes/names — no serial ids anywhere**. This makes the
migration materially simpler than ModMail's ([06-modmail-port.md](06-modmail-port.md) item 1): nothing to regenerate,
no cross-deployment id collisions, and an accidental re-run fails loudly on PK conflicts instead of silently
duplicating history. A seventh table in any dump is Prisma's `_prisma_migrations` ledger; ignore it.

## Redesign ledger

The exhaustive "where warranted" list. Each item is a decision, not an open question — revisit only with the owner.

1. **The `/config` mega-command dies; config is dashboard-first.** The new stack's convention (AMA, ModMail) is: config
   lives on the dashboard, and the shared `/dashboard` grant-token command
   ([01-architecture.md §4a](01-architecture.md#4a-dashboard-command-auth-guild-scoped-session-no-oauth-194)) gets you
   there from Discord. The same goes for `/channel`, `/role`, `/reward`, and `/interaction` **write** subcommands —
   they're all config CRUD wearing a slash-command costume, and the old dashboard already proved this surface works as
   web UI (its API had exactly these CRUD routes and nothing else). What stays in Discord: `/level` (the product's
   actual read surface), the interaction commands themselves, and `/dashboard`.
2. **The `roles.set()` reward rebuild is replaced with additive diffing.** Compute exactly which reward roles to add
   and which `clean`-tier roles to remove, and issue only those changes. The legacy rebuild-everything approach has a
   confessed bug history (the TODO/screenshot hack around clean roles), races with other bots' role changes, and
   made failure handling so coarse it once barred whole guilds. Behavior parity target: same resulting role state,
   different mechanism.
3. **Per-interaction guild commands stay, with resync designed in from day one.** The UX (a real `/hug` command with
   its own name) is the feature and is kept. But stored `commandId`s belong to an _application_, and at cutover every
   one of them 404s under the new bot's application — the exact lesson ModMail snippets taught
   ([01-architecture.md §8](01-architecture.md#8-custom-modmail-instances-216), snippets resync). So: `command_id` is
   nullable, a resync routine (re-register all of a guild's interactions, update ids) exists as both a cutover step and
   a dashboard affordance, and dispatch tolerates a stale id by falling back to a `(guild_id, name)` lookup against the
   invoked command's name before declaring the interaction missing.
4. **Multipliers stay integers.** Parity: channel multipliers 1–10, role multipliers as-is, `int` columns. Widening to
   fractional (0.5×) is a real feature request shape but changes XP math on a hot path — out of scope; file it as a
   follow-up issue if wanted.
5. **Leaderboard: optional follow-up, not port scope.** The legacy bot has no leaderboard anywhere (`/level` is the
   only read). A dashboard leaderboard page is the obvious new-stack win and the `social_users` table trivially
   supports it (`ORDER BY xp DESC`), but it must not block cutover. Not planned in the phases below; noted here so the
   schema doesn't preclude it (it doesn't).

Explicitly _not_ redesigned: the XP curve (frozen for migration fidelity), the Redis eligibility engine (ports
near-verbatim, same keys and semantics), notification modes/templating, the channel→category→thread-grandparent
resolution walk, and the interaction content/templating model (`{{ author }}`/`{{ targets }}`, embed options).

## New-stack mapping

Where each piece lands, following the ModMail port's shape (the most recent full-subsystem precedent):

- **Schema** → `packages/private/db/schema/schema.sql` (Atlas declarative) + generated migration + kanel regen.
  **Tables are `social_`-prefixed**: `social_guild_settings`, `social_users`, `social_channels`, `social_roles`,
  `social_rewards`, `social_interactions`. (AMA's `ama_*` prefix is the precedent to follow; ModMail's unprefixed
  `guild_settings`/`threads` are grandfathered, not a pattern — and `guild_settings` is literally taken.)
  `level_up_notification_mode` becomes a `CHECK`-constrained text column or enum per whatever the schema already does
  for similar unions; legacy's nullable-config gate (settings row exists but required fields null ⇒ bot inert) is
  preserved as nullable columns, since "row exists, not yet fully configured" is a real state the dashboard flow needs.
- **API** → `services/api` routes on the `defineRoute` contract pattern, mirroring the ModMail route set's structure
  (per-guild config CRUD; see git history of #153): settings get/update, channels list/upsert/delete, roles
  list/upsert/delete, rewards list/upsert/delete, interactions list/create/update/delete (+ resync, ledger item 3).
  The legacy `packages/api` is reference-only for surface area; nothing is copied from it.
- **Bot** → new **`services/social-bot`** on `@chatsift/bot-core`, scaffolded from `services/modmail-bot`
  (`bin.ts` + `index.ts` + `commands/` + `lib/`). Registry additions: `'SOCIAL'` in `BOTS`
  (`packages/private/core/src/lib/constants.ts`), `SOCIAL_BOT_TOKEN` env plumbing, and the `bot:SOCIAL` Redis guild
  list (`packages/private/backend-core/src/lib/data/bots.ts`) so the dashboard sees guild presence. Global commands
  bulk-overwritten like AMA's (never per-guild — except, uniquely here, the per-interaction commands, which are
  per-guild _by design_). P3 includes an explicit **gateway-intent audit**: message tracking needs guild message
  events (not message _content_) and member role state; verify what bot-core's client needs rather than copying
  legacy's intents.
- **Dashboard** → `apps/website` per-guild Social section following the AMA/ModMail config layout: settings form
  (curve, gains, eligibility window, notification mode/template), channels & roles multiplier/ignore management,
  rewards editor, interactions editor with create-flow on a dedicated `/new` page (the #240 convention). The XP-curve
  form should surface a small level→required-XP preview table computed with the exact formula, since curve mistakes
  are the config error that hurts most.

## Phases

Additive throughout; nothing touches legacy until P6. Each phase ends verified per
[workflow.md](../workflow.md#verification-standard) — run the affected service and exercise the change against the
test guild, not just build/lint/test.

- [x] **P1 — Schema.** Six `social_*` tables per the mapping above; Atlas migration; kanel regen. Unit-test nothing
      here beyond what the schema tooling already enforces; the shape gets exercised by P2/P3.
      _Done._ `social_guild_settings`, `social_users`, `social_channels`, `social_roles`, `social_rewards`,
      `social_interactions` + a `social_level_up_notification_mode` enum, in `schema/schema.sql`'s Social section
      (migration `20260811185101_add_social_tables.sql`). That section's header comment enumerates the four
      deviations from the legacy schema **P5 has to encode** — uppercased notification-mode values, NOT NULL
      multipliers coalescing legacy's NULL to 1, `social_interactions`' surrogate `id` + nullable `command_id`, and
      guild-first composite PKs. Config bounds are deliberately _not_ CHECKs (legacy only ever enforced them in
      slash-command option definitions, so prod data isn't guaranteed to satisfy them); they land in P2's zod
      schemas. The only CHECKs are the ones bad data would genuinely break: `required_xp_base`/
      `required_xp_multiplier` `>= 1` (a 0 in either makes the level walk non-terminating), multipliers `>= 1`, and
      `social_rewards.level >= 0`. Dispatch's `(guild_id, command_id)` partial index is **UNIQUE** — two rows
      sharing a command id would make dispatch pick one nondeterministically — which obliges the P3/P6 resync to
      clear a guild's command ids before writing the new ones rather than updating row-by-row (a bulk overwrite
      preserves a command's id by name, so an in-place order exists that transiently collides). No generated types
      were exported from `@chatsift/db`'s `index.ts` yet — that file's convention is to add a table the first time a
      consumer needs it, which is P2.
- [x] **P2 — API.** The route set above, with zod validation mirroring legacy's bounds (config bounds listed in the
      feature catalog — the dashboard inherits them as its validation source of truth). Vitest coverage per the
      existing route-test patterns.
      _Done_, 16 routes under `services/api/src/routes/social/`: config get/patch, channels & roles & rewards
      list/upsert/delete, interactions list/create/patch/delete + resync. Schemas are browser-safe and exported as
      `@chatsift/api/social-schemas` for P4, with 17 vitest cases pinning the legacy bounds, the enum casing, the
      full-representation PUT defaults and the zod-v4 `.partial()`-keeps-defaults trap. Notes for later phases: - **`SOCIAL` is now a real `BotId`** (`packages/private/core`), which is what lets social routes use
      `apiForGuild`/the per-`(bot, guild)` channel+role caches like every other product. `SOCIAL_BOT_TOKEN` is a
      **required env var** — the API won't boot without it, locally or in prod. - Marketing is decoupled from `BOTS`: `apps/website`'s `marketingBots` is keyed by a new `MARKETED_BOTS`
      subset, and every public surface (homepage grid, `/bot/[name]` + its OG image, cross-bot upsells) iterates
      that instead. Social therefore has a dashboard identity (icon, label, nav tab once installed) with no public
      page — move it into `MARKETED_BOTS` at launch. The dashboard's "invite a bot" affordances are filtered the
      same way, since `/invites/social` doesn't exist yet. - Resync is **shared machinery** now: `services/api/src/util/commandResync.ts` (+ `util/resync.ts` for the
      failure shape, moved out of `routes/modmail/resyncShared.ts`). ModMail's snippet resync was refactored onto
      it with its wire shape unchanged; Social's differs only in supplying `clearCommandIds` (the nullable
      `command_id` + UNIQUE index need clear-then-write). Applies to canary↔production movement as much as
      cutover, which is why it's a permanent route rather than a one-off script. - `getModmailApplicationId` generalized to `getBotApplicationId(botId, guildId)`; the embed-image URL rule
      moved to `util/schemas.ts` as `httpUrlSchema` (was private to modmail's schemas). - **Not verified live** — the API needs a real `SOCIAL_BOT_TOKEN`, and there's no Social bot to issue one for
      until P3. Build/lint/test green; exercising these against Discord happens with P3/P4.
- [ ] **P3 — Bot.** Scaffold `services/social-bot`; port the tracking engine (Redis keys and semantics verbatim, keys
      documented in code); implement additive role-diffing (ledger 2); `/level`; `/dashboard`; interaction dispatch +
      per-guild command registration with resync (ledger 3 — clear-then-write, see P1's note); level-up
      notifications; intent audit. This is the phase
      with real behavioral risk — verify XP gain, window cooldown, multiplier stacking, clean-tier promotion, and each
      notification mode live in the test guild.
- [ ] **P4 — Dashboard.** The section described above. Verify each form round-trips against the P2 API and that
      interaction create/resync reflects in Discord.
- [ ] **P5 — Migration script.** `packages/private/db/src/scripts/migrateLegacySocial.ts` +
      `yarn migrate:legacy-social`, cloned from `migrateLegacyModmail.ts`'s conventions: `LEGACY_DATABASE_URL`,
      `--dry-run` (full run in a rolled-back transaction) / `--live` / `--verify` (read-only reconciliation: per-table
      counts, per-guild XP sums, random-sample row comparison). Keep `--source` for consistency even though Social has
      a single legacy deployment and natural PKs already make re-runs fail loudly — it's cheap and keeps the two
      scripts' operator ergonomics identical. Mapping is 1:1 snake_casing with two exceptions:
      `social_interactions.command_id` is written **`NULL`** (legacy ids belong to the legacy application; the P6
      resync assigns real ones), and anything Redis (`leveling_tracking`/`leveling_ineligible` keys, legacy db 1) is
      **deliberately not migrated** — ephemeral by design; worst case a user's cooldown resets once at cutover.
      Verified with the two-scratch-database method established for ModMail (src/dst throwaway DBs, id-independent
      diff) before ever touching a prod dump.
- [ ] **P6 — Cutover.** Runbook, mirroring [06-modmail-port.md](06-modmail-port.md)'s but simpler — no open-thread
      concept, no per-guild manual repair step, no comms-critical moderator surface: 1. Dry-run against a restored copy of the prod `social` database; record wall-clock (the `User` table is the
      only unknown-magnitude table; nobody has counted it) and size the window off that. 2. Announce/schedule a short maintenance window if the dry-run warrants one at all — XP accrual pausing for
      minutes is far less user-visible than ModMail messages dropping. 3. Freeze = stop the legacy bot (XP accrues on every message; a stopped bot is a consistent snapshot — nothing
      to force-close). Snapshot the database; archive the dump offsite (it's per-user activity data — IDs and
      counters, no message content). 4. Migrate + `--verify` against the snapshot into prod. 5. Deploy `services/social-bot` with the legacy application's token (or a new application if a clean break is
      preferred — decide before P6; a new application also invalidates nothing extra, since interaction commands
      get resynced either way). 6. Run the interactions resync for every guild that has any (ledger 3). 7. Smoke test in a real guild: send messages → XP gained; window cooldown enforced; level-up notification;
      reward role applied; `/level` shows migrated XP; a custom interaction responds. 8. Keep the legacy deployment + database warm for rollback until confident, then decommission
      (`stack/docker-compose.social.yml`, the `social` database on `postgres-old`, the DockerHub image pipeline).

## Verification

Per-phase live verification as listed above ([workflow.md](../workflow.md#verification-standard) is the standard —
build/lint/test alone doesn't prove a feature). The migration script gets the two-scratch-DB treatment in P5 before any
prod dump is involved; P6's dry-run wall-clock is the only honest window estimate, same discipline as ModMail's. The
XP-curve formula gets a dedicated unit test pinning known (settings, xp) → level values, since it's the one piece of
math a refactor could silently break and a migration fidelity guarantee depends on.
