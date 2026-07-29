# #216 — Single-guild custom-instance mode (branded ModMail deployments + DM front door)

**Tracking issue:** [#216](https://github.com/ChatSift/ChatSift/issues/216). **Depends on:** M5 (`06-modmail-port.md`) and the thread-history work ([01-architecture.md §7](01-architecture.md#7-modmail-thread-history-dashboard-view-261)) — both landed. **Live production impact:** yes, but additive: no data migration, and the public instance's behavior is unchanged for every guild that doesn't have a custom instance.

## Status: planned 2026-07-29, not started

Supersedes the "Future, explicitly not this milestone" section of [06-modmail-port.md](06-modmail-port.md), which reserved the design space but deliberately left it unbuilt. That section's one binding constraint on M5 — "don't hardcode 'a ticket always starts via a private thread' deep into the relay/close/snippet/block/alert logic" — was honored, and this plan cashes it in: the DM entrypoint below reuses `threads`/`thread_messages` untouched.

## Goal

Offer branded, per-partner ModMail deployments to approved close partners. Each is a separate bot application, locked to one guild, deployed as its own service in this repo's `docker-compose.yml`, sharing the main stack's Postgres/Redis/API. Optionally, such an instance can run in **DM mode** — users DM the bot to open a ticket instead of clicking a panel button, matching the pre-M5 production ModMail behavior.

## Owner's decisions (2026-07-29)

Captured verbatim in intent, since several of these close off otherwise-reasonable alternatives:

1. **Deployments are hand-managed** in `docker-compose.yml`, one service block per approved partner. No self-serve, no provisioning flow.
2. **Custom instances fully share tables with the public instance.** No per-instance schema, no data partitioning. This is what makes moving a partner on/off the public instance a config change rather than a migration.
3. **The codebase must gate the public instance off** for any guild that has a custom instance, in case server admins leave both bots in the guild. Doubling the relay or the recording is the disaster case.
4. **DM mode is a DB toggle**, not an env var — so the team can flip it from the dashboard's Config section instead of redeploying. (Original framing was an env var; DB won because it's the same cost.)
5. **Dashboard is invisible to regular users.** A partner sees their custom bot's own avatar on their guild card in `/dashboard`, and a ModMail section identical to the public one, just branded.
6. **Settings DM mode can't honor stay editable**, with a tooltip explaining they don't apply. Specifically `greeting_before_opener` (a greeting can only ever land _after_ the opener in DM mode) and `max_concurrent_threads` (hard-capped at 1).
7. **DM-mode category list = all of the guild's categories** (`categories` rows, `ORDER BY sort_order, id`). Panels and `ticket_panel_categories` are dead config in DM mode.
8. **Messages sent between the opener and the category pick are not relayed** — the user gets a nudge to pick a category first. Only the opener becomes the ticket's first message.
9. **A panel button click while DM mode is on is inert**, answering with a "this server uses DMs — just message me directly" ephemeral. Panels are never auto-deleted; flipping DM mode back off must restore the panel flow exactly.
10. **Instance→application ownership drift is fixed by an explicit dashboard "Resync" button**, not automatically on boot. Snippet slash-commands and panel messages belong to whichever Discord application created them, so an instance swap orphans both.
11. **The instance registry is a DB table**, not an env var. (Original framing was a JSON env var; rejected — at that shape it may as well be a table.)

## Architecture

### What actually needs to change, and why

Two pieces of the existing code are genuinely incompatible with a second deployment, and both are load-bearing:

**The API hardcodes the public ModMail bot token.** `services/api/src/util/discordAPI.ts` exports a single `discordAPIModmail` built from `ENV.MODMAIL_BOT_TOKEN`, and 12 call sites use it directly — panel create/update/delete, snippet guild-command registration, block-list user lookups, and the entire #261 thread-history view (`routes/modmail/threads/util.ts`). For a partner whose guild has only their custom bot in it, every one of those is a 403. `fetchGuildChannels(guildId, 'MODMAIL')`, `assertRolesBelongToGuild(…, 'MODMAIL', …)` and `roundRobinAPI` have the same problem one layer down, since they resolve a client through `APIMapping[BotId]`.

**All four bot sweeps query globally with no guild filter.** `sweepAbandonedPendingTickets`, `sweepScheduledCloses`, `sweepThreadNukes` and `preventOpenThreadsFromArchiving` (`services/modmail-bot/src/lib/`) each scan `threads`/`pending_tickets` across every guild. Two deployments polling the same shared tables means double-closing tickets, double-deleting private threads, and two processes racing to unarchive the same channel. This is not a cosmetic concern — it's the primary correctness risk in the whole feature.

**What does _not_ need gating, contrary to first instinct:** component and slash-command interactions are Discord-application-scoped. A button on a panel message posted by the custom bot is only ever dispatched to the custom bot's gateway; a guild slash-command registered under one application never fires on another. So interaction handlers get an ownership guard for defense-in-depth and for correct behavior on leftovers after a swap — but the doubling risk is confined to **raw gateway message events** (`MESSAGE_CREATE`/`UPDATE`/`DELETE`, which both bots receive if both are in the guild) and **the DB sweeps**.

### The ownership rule

One rule, applied identically in the bot and the API:

> If a guild has a `modmail_instances` row, that instance owns the guild. Otherwise the public instance owns it.

`modmail_instances.guild_id` is `UNIQUE`, so "one owner per guild" is a database invariant rather than a convention. The rule holds whether or not the public bot is also present in the guild, which is exactly the failure mode decision (3) is defending against.

Scope predicates that fall out of it:

- Public deployment: `guild_id NOT IN (SELECT guild_id FROM modmail_instances)`
- Custom deployment: `guild_id = <its own instance's guild_id>`

### Instance registry (new table)

```sql
-- Registry of branded, single-guild ModMail deployments (#216). A row here is what makes a guild
-- "owned" by a custom instance: the public modmail-bot deployment no-ops for any guild listed here,
-- and services/api routes every Discord call for that guild through this instance's token instead of
-- MODMAIL_BOT_TOKEN. Rows are inserted by hand (see docs/workflow.md) alongside adding the matching
-- docker-compose service -- there is deliberately no API/dashboard CRUD for this table, since it
-- holds a live bot token.
CREATE TABLE modmail_instances (
  -- Slug, matched against the deployment's own MODMAIL_INSTANCE_ID env var. Stable; renaming one
  -- means redeploying the service that carries it.
  id         TEXT PRIMARY KEY,
  -- One instance per guild, enforced here rather than in application code -- the whole ownership
  -- model in docs/roadmap/08-modmail-custom-instances.md rests on this being unambiguous.
  guild_id   TEXT NOT NULL UNIQUE,
  -- The custom bot application's token, encrypted at rest with ENCRYPTION_KEY (AES-256-GCM), same
  -- key the JWT signing path already uses. Encrypted rather than plain because a Postgres dump or a
  -- backup snapshot would otherwise carry live bot credentials for every partner.
  token      TEXT NOT NULL,
  -- Display name shown in place of "ModMail" throughout this guild's dashboard.
  label      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The token column stores `iv:authTag:ciphertext` (base64 segments); a small `encryptSecret`/`decryptSecret` pair in `packages/private/backend-core` handles it. If the team would rather not encrypt, the alternative is plaintext plus a note that DB dumps become credential material — but the encrypted path is a few dozen lines and `ENCRYPTION_KEY` already exists, so it's the recommendation.

### Registry access (`packages/private/backend-core/src/lib/instances.ts`, new)

Loaded into an in-memory snapshot at boot and refreshed on a 60-second interval, so the hot paths (`apiForGuild` runs on effectively every outbound Discord call) read synchronously with no per-call DB round trip:

```ts
loadInstances(): Promise<void>          // boot; throws on failure (fatal for a custom deployment)
getInstanceForGuild(guildId): Instance | null
getCustomInstanceGuildIds(): ReadonlySet<string>
getSelfInstance(): Instance | null      // resolved from ENV.MODMAIL_INSTANCE_ID, bot processes only
```

The refresh interval is what makes onboarding a partner not require restarting the public bot: within 60s of the row appearing, the public deployment stops acting on that guild on its own. The runbook still orders the steps so that window never matters (insert the row _first_, start the custom service _after_).

`ENV.MODMAIL_INSTANCE_ID` is the only new env var — a single optional scalar, set in the custom service's docker-compose `environment:` block. This is the "env var that locks the deployment to a guild" from the issue; the guild id itself comes from the row, so the two can't drift apart. A custom deployment whose `MODMAIL_INSTANCE_ID` matches no row must fail fast at boot rather than silently behaving like a second public instance.

### Redis guild lists

`GuildList` (`backend-core/src/lib/data/bots.ts`) keys on `bot:<BotId>` and each deployment overwrites the whole key every 10 seconds. Two ModMail deployments sharing `bot:MODMAIL` would flap between two disjoint guild sets. Custom deployments publish to `bot:MODMAIL#<instanceId>` instead; the key type widens to `` BotId | `${BotId}#${string}` ``. `fetchMe` unions the public list with every instance's list when deciding whether `MODMAIL` is installed in a guild.

### DM mode

Two new columns, no new tables:

```sql
-- Whether this guild's ModMail runs on the pre-M5 DM front door instead of ticket panels (#216).
-- Only meaningful for a guild with a modmail_instances row -- the public deployment never reads it,
-- and services/api rejects setting it true for a guild with no custom instance. When on, ticket
-- panels go inert (see the create-ticket component) and the panel-specific settings below stop
-- applying, but nothing about them is deleted: flipping this back off restores the panel flow as-is.
ALTER TABLE guild_settings ADD COLUMN dm_mode BOOLEAN NOT NULL DEFAULT false;

-- How this ticket was opened. 'panel' is the M5 flow (user_thread_id is a real private thread this
-- bot created and may lock/delete); 'dm' means user_thread_id is the opener's DM channel id, which
-- must never be locked, archived or deleted. Rows migrated from the pre-M5 production ModMail are
-- backfilled to 'dm', which is historically accurate -- they're all closed, so nothing acts on them.
ALTER TABLE threads ADD COLUMN origin TEXT NOT NULL DEFAULT 'panel';
ALTER TABLE threads ADD CONSTRAINT threads_origin_check CHECK (origin IN ('panel', 'dm'));
```

**Why `user_thread_id` holds the DM channel id.** A DM channel id is stable per (user, bot application) pair, so storing it there makes `findOpenThreadByUserThreadId` (the user→mod relay lookup), `relayStaffReplyToUserThread` (which posts to `thread.userThreadId`), and the whole `userMessageLifecycle` edit/delete sync work in DM mode with **zero changes**. That's the single biggest reason DM mode isn't a fork of the relay layer. The cost is that a raw `user_thread_id` value no longer tells you what kind of channel it is, which is precisely what `origin` is for — and every place that treats it as a manipulable thread (`closeThread`'s lock, `threadNukeSweep`, `preventThreadArchive`) must branch on `origin`, not on truthiness.

**The DM opener flow:**

1. A DM arrives from a user with no open thread in the locked guild → this is an opener.
2. Bot checks guild membership (fetch member; a non-member gets told to join first) and blocks (`findActiveBlock`, same messaging as the panel path).
3. If the guild has categories → post a category select into the DM and stash pending state in Redis (`{ guildId, openerMessageId }`, 30-minute TTL, keyed by user id). If it has none → skip straight to step 5 with `category = null`.
4. Further DMs while pending get a nudge ("pick a category above to open your ticket") and are **not** relayed (decision 8). The opener message is re-fetched by id at pick time rather than serialized into Redis, so attachments/stickers/forwards need no special handling.
5. On pick (or immediately, no-category path): create the mod-forum thread via the existing `finishTicketCreation`, with `user_thread_id = <DM channel id>` and `origin = 'dm'`, relay the opener, then post the greeting — **always after**, `greeting_before_opener` is ignored (decision 6).
6. From there the flow is identical to the panel flow: subsequent DMs relay into the open thread, staff replies relay back, `/close` ends it.

No `pending_tickets` row is written for a DM-pending ticket. That table exists so `pendingTicketSweep` can delete abandoned _private threads_ — there's no channel to clean up here, and the concurrency cap of 1 is already enforced by the "no open thread" check that defines an opener in the first place.

**Undeliverable DMs.** `relayStaffReplyToUserThread` currently posts the mod-side log copy and the user-facing copy in a single `Promise.all`. In DM mode a user with DMs closed, or who blocked the bot, produces a `50007` and mods would be left looking at a logged reply the user never received. The two sends get resequenced — user copy first, then the log copy and the `thread_messages` insert — and a `50007`/403 raises a typed `UndeliverableUserError` before anything is logged or recorded. `/reply`, `/reply-q`, both reply context menus and the snippet resolver all catch it and answer with a distinct message ("Couldn't DM <user> — they have DMs closed or left the server. Nothing was sent."). This resequencing is a strict improvement for the panel flow too, where a deleted private thread has the same failure shape.

## Phases

Each phase is one PR, each independently mergeable and verifiable. P1–P3 ship the instance concept with no DM support at all — a custom instance at that point is a cosmetically separate bot running the ordinary panel flow, which is already a shippable product.

### P1 — Registry table + ownership gating (bot side)

- `packages/private/db`: `modmail_instances` table, Atlas migration, kanel regen.
- `packages/private/backend-core`: `lib/instances.ts` (above); `encryptSecret`/`decryptSecret`; `ENV.MODMAIL_INSTANCE_ID` (optional); `GuildList` key type widening in `lib/data/bots.ts`.
- `services/modmail-bot/src/bin.ts`: resolve self-instance → token and `botId` (`MODMAIL` or `MODMAIL#<id>`); add the `DirectMessages` intent (harmless for the public deployment, required later by P4); fail fast on an unresolvable `MODMAIL_INSTANCE_ID`.
- `services/modmail-bot/src/lib/instance.ts` (new): `ownsGuild(guildId)` plus the SQL scope fragment the sweeps use.
- Gate the three raw listeners in `services/modmail-bot/src/index.ts` (`registerMessageRelay`, both halves of `registerMessageLifecycleRelay`).
- Scope all four sweeps: `lib/pendingTicketSweep.ts`, `lib/scheduledCloseSweep.ts`, `lib/threadNukeSweep.ts`, `lib/preventThreadArchive.ts`.
- `packages/private/bot-core`: optional `setGuildOwnershipFilter(fn)` hook consulted by `handleCommandInteraction`/`handleComponentInteraction`/`handleAutocompleteInteraction`, so an unowned guild's leftover commands answer with "this server is served by <label>" instead of acting on shared rows.

_Verify:_ public bot in a guild that has a registry row ignores every message event and sweeps nothing for it; the same guild with the row removed goes back to normal within one refresh interval.

### P2 — Instance-aware API

- `services/api/src/util/discordAPI.ts`: `apiForGuild(botId, guildId)`, backed by a lazily-built per-instance `REST`/`API` pair; `roundRobinAPI` resolves through it.
- Replace every direct `discordAPIModmail` use: `util/discordApplication.ts` (`getModmailApplicationId(guildId)`, memoized per instance), `routes/modmail/blocks/listBlocks.ts`, `routes/modmail/snippets/{create,update,delete}Snippet.ts`, `routes/modmail/panels/{create,update,delete}Panel.ts`, `routes/modmail/threads/{listThreads,util}.ts`.
- `util/channels.ts`, `util/roles.ts`, `util/emojis.ts`, `util/guildDataCache.ts`: the `(botId, guildId)` cache partition gains the instance id, since two applications in one guild genuinely see different channel sets.
- `util/me.ts`: union the per-instance guild lists; add `customInstanceId`/`customInstanceLabel`/`customInstanceIconUrl` to `MeGuild`. **The `me:` Redis key prefix must be bumped** — bin-rw recipes are positional and there is no version marker in `RedisStore`, so pre-existing cached entries would misdecode against the new recipe for up to the 5-minute TTL.
- The instance's avatar/label come from `applications.getCurrent()` on the instance token, cached in Redis.

_Verify:_ a partner guild with only the custom bot present loads the full ModMail dashboard — config, categories, panels, snippets, blocks, thread history — with no 403s.

### P3 — Dashboard branding

- `apps/website/src/utils/bots.tsx`: `resolveBotBranding(guild, bot)` returning either the static `Bots[bot]` entry or the instance's CDN avatar + label.
- Consume it in `app/dashboard/_components/GuildCard.tsx`, `app/dashboard/[id]/_components/GuildNav.tsx`, `app/dashboard/[id]/page.tsx`, `components/dashboard/DashboardCrumbs.tsx`.
- Routes stay `/dashboard/[id]/modmail` — identical pages, different chrome (decision 5).
- A guild with no custom instance renders byte-identically to today.

_Verify:_ partner guild shows the custom avatar and label on the guild card, nav tab, section card and breadcrumbs; a normal guild is unchanged; a user in both sees each correctly.

### P4 — DM mode: schema, config surface, opener flow

- `packages/private/db`: `guild_settings.dm_mode`, `threads.origin` + check constraint, migration, kanel regen.
- `services/api`: `dmMode` in the modmail config get/update schemas, rejected with a 400 when the guild has no `modmail_instances` row.
- `apps/website`: DM-mode toggle in `ModmailConfigForm`, rendered only for a custom-instance guild; tooltips on `greeting_before_opener` and `max_concurrent_threads` explaining they don't apply while it's on; an informational banner on the panels page.
- `services/modmail-bot/src/lib/dmTicket.ts` (new): opener detection, membership + block checks, category prompt, pending state, nudge path.
- `services/modmail-bot/src/components/dmCategorySelect.ts` (new): resolves guild from the self-instance (DM interactions carry no `guild_id` and no `member`), re-fetches the stashed opener, creates the ticket.
- `services/modmail-bot/src/lib/ticketCreation.ts`: fetch the guild member explicitly in DM mode (a DM `MESSAGE_CREATE` carries no `member`, which the opening embed's roles/join-date fields need); force greeting-after ordering.
- `services/modmail-bot/src/index.ts`: route DM messages (`guild_id` absent) into the DM path, ahead of the existing thread lookups.

_Verify:_ DM opener → category prompt → pick → mod-forum thread with the right tag → opener relayed → greeting after; a mid-pick message gets the nudge and is not relayed; a no-category guild skips straight to thread creation; a blocked user and a non-member are both rejected.

### P5 — DM-mode divergences and error surfaces

- `lib/threadClose.ts`: `origin = 'dm'` skips the private-thread lock and never schedules a nuke; the farewell posts into the DM.
- `lib/threadNukeSweep.ts`, `lib/preventThreadArchive.ts`, `lib/pendingTicketSweep.ts`: skip DM-origin threads.
- `lib/relay.ts`: resequence user-copy-before-log-copy; typed `UndeliverableUserError`.
- `commands/reply.ts`, `commands/replyQuick.ts`, `lib/replyContextMenu.ts` (both context menus) and the snippet resolver in `index.ts`: surface the undeliverable-DM message.
- `components/createTicket.ts`: inert redirect reply while DM mode is on (decision 9).
- Concurrency clamped to 1 in DM mode regardless of `max_concurrent_threads`.

_Verify:_ close a DM ticket (farewell delivered, no lock/nuke attempted, mod thread archived); staff reply to a user with DMs closed shows the distinct error and leaves no log copy or `thread_messages` row; a panel click while DM mode is on creates nothing.

### P6 — Resync + operations

- `POST /v3/guilds/:guildId/modmail/resync` (guild manager, or global admin): re-register every snippet as a guild command under the _currently owning_ application, rewrite `snippets.command_id`, delete stale commands, repost panel messages whose original belongs to a different application and update `ticket_panels.message_id`.
- Dashboard button in the ModMail config page, shown for custom-instance guilds and to global admins.
- `docker-compose.yml`: per-partner service block template (image reuse, `MODMAIL_INSTANCE_ID`, own log volume).
- `docs/workflow.md`: onboarding/offboarding runbook — insert the row first, start the service second, resync third; reverse order to offboard.

_Verify:_ move a test guild from the public instance to a custom one and back; after each swap, resync restores working `/snippet` commands and a clickable panel.

## Risks and known sharp edges

- **Onboarding order matters.** The public bot stops acting on a guild within 60s of the row appearing. Insert the row before starting the custom deployment and that window is never live; do it the other way around and both bots briefly relay.
- **Tokens for partner bots live in the main stack's database.** Unavoidable given decision 2 — the API must be able to act _as_ the partner's bot to post panels and mint snippet commands. Encrypted at rest; the encryption key stays in `.env.private`.
- **A swap orphans application-scoped objects.** Snippet commands and panel messages belong to the application that created them. P6's resync is the answer; until it runs, a swapped guild has dead `/snippet` commands and a panel whose button dispatches to a bot that no longer owns the guild (and which, thanks to P1's ownership filter, answers with the "served by <label>" message rather than doing something wrong).
- **`origin` is the only thing distinguishing a DM channel from a private thread** in `user_thread_id`. Any future code path that locks, archives or deletes `user_thread_id` must branch on it. Worth a doc comment on the column itself, which the DDL above has.
- **DM mode ignores real settings.** `greeting_before_opener` and `max_concurrent_threads` remain editable and visibly do nothing (decision 6). The tooltips are the entire mitigation; if that proves confusing in practice, disabling the inputs is a one-line follow-up.

## Explicitly out of scope

- Self-serve or dashboard-driven instance provisioning (decision 1).
- Custom instances of AMA, or of any product other than ModMail.
- Per-instance schema, data partitioning, or any migration when moving a partner between instances (decision 2 is what buys this).
- Automatic reconciliation of snippet commands/panels on boot — rejected in favor of the explicit button (decision 10).
