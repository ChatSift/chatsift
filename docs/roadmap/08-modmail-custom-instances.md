# #216 — Single-guild custom-instance mode (branded ModMail deployments + DM front door)

**Tracking issue:** [#216](https://github.com/ChatSift/ChatSift/issues/216). **Depends on:** M5 (`06-modmail-port.md`) and the thread-history work ([01-architecture.md §7](01-architecture.md#7-modmail-thread-history-dashboard-view-261)) — both landed. **Live production impact:** yes, but additive: no data migration, and the public instance's behavior is unchanged for every guild that doesn't have a custom instance.

## Status: P1–P5 shipped and merged to `main` (#278/#279/#280/#281/#282); P6 implemented + smoke-tested 2026-07-30

P6 (resync + operations) is implemented: `POST /v3/guilds/:guildId/modmail/resync` (`services/api/src/routes/modmail/resync.ts`), a "Resync" button in `ModmailConfigForm.tsx` shown for custom-instance guilds and global admins, a commented-out per-partner service template in `docker-compose.yml`, and an onboarding/offboarding runbook in [docs/workflow.md](../workflow.md#custom-modmail-instances-216). See the P6 section below for the design and a real architectural asymmetry it surfaced between onboarding and offboarding. Left staged/uncommitted per this repo's CLAUDE.md.

**Smoke-tested 2026-07-30 against real Discord infrastructure**, bypassing HTTP/auth (called the route's `handler` directly against the real DB/redis/Discord bot token — auth/middleware is already covered by `isAuthed`'s own tests and is identical to every other already-verified modmail route) since a genuine cross-application scenario needs a second real Discord application, which wasn't set up this session:

- No-op path: ran resync against the test guild's real pre-existing panel with no changes pending — `editMessage` succeeded (same app), `panelsReposted: 0`, message untouched.
- Snippet recreate + stale-delete: inserted a `snippets` row with a deliberately-bogus `command_id` (simulating "this predates the current owner") and, via a direct Discord call, a real orphan guild command not backed by any snippet. Resync correctly recreated the snippet's command (new real command id, `snippets.command_id` rewritten) and deleted the orphan (`snippetsRecreated: 1`, `staleCommandsDeleted: 1`) — confirmed on Discord's side afterward that only the legitimate command remained.
- Panel repost (message-gone branch): deleted the test guild's real panel message directly via Discord, then reran resync — it detected the `10008 UnknownMessage`, fell back to the default "Create Ticket" label (since the read-back-label fetch also 404s when the message is gone), posted a fresh message with the original embed content, and rewrote `ticket_panels.message_id` (`panelsReposted: 1`) — confirmed the new message rendered correctly with the right embed/button on Discord's side.

**Not exercised: the `50005 CannotEditMessageAuthoredByAnotherUser` branch specifically** (a message that still exists but belongs to a genuinely different application) and preserving a _non-default_ button label read back off a still-live foreign message — both need a second real Discord application token to trigger, since the same-token trick makes every message/command belong to "the same app" by construction. The code path after either caught error code is identical (same repost/recreate logic), so this is a real but narrow gap, not an untested feature. Test artifacts (`dev-test` registry row, test snippet + its Discord command) were torn down after; the real panel's message was deliberately left on its new (correctly reposted) message id rather than reverted, since that's genuine working state, not test debris.

**Picking this up in a new session? Read this before touching P4's history:**

- P1/P2/P3 are committed on `main`. P4 (below) is implemented and manually verified this session (three rounds — an initial pass plus two rounds of bugs found live and fixed) but left staged/uncommitted per this repo's CLAUDE.md — check `git status`/`git diff` before assuming what's merged.
- **Column rename, not just new columns:** `threads.user_thread_id` is renamed to `user_channel_id` (schema, a hand-fixed migration — see below — kanel types, every `services/modmail-bot` call site). The name was already misleading once a DM channel could live there; fixed now rather than carrying the confusion forward. The matching index is `threads_user_channel_id_idx`. `lib/ticketCreation.ts`'s `privateThreadId` params were renamed to `userChannelId` for the same reason — that function is now called from both the panel and DM paths.
- **The migration needed a hand fix.** `atlas migrate diff` rendered the rename as `DROP COLUMN` + `ADD COLUMN` rather than `RENAME COLUMN` — on a database with real rows this would have silently nulled out every ticket's channel id. Fixed to an explicit `RENAME COLUMN`/`ALTER INDEX ... RENAME` in the generated migration file before applying it, then re-ran `atlas migrate hash` to fix the checksum. Worth checking any future atlas-generated rename the same way — it does not detect renames reliably by default.
- **Most of P5's originally-planned scope shipped as part of P4**, not deferred — a live manual-testing pass on the very first cut of the DM opener flow immediately surfaced three real bugs and one design gap that the original phase split (schema+config+opener in P4, error surfaces in P5) didn't anticipate would matter this early:
  - The panel button stayed live while DM mode was on (`createTicket.ts`/`categorySelect.ts` now check `guildSettings.dmMode` and reply with the inert redirect — decision 9). This was found immediately, not deferred.
  - `/reply-q` was the one relay call site with no `defer`/try-catch at all (the other three already had one) — a failed relay left the interaction with zero response ("The application did not respond"), not a process crash. Fixed alongside pulling all of `lib/relay.ts`'s resequencing + `UndeliverableUserError` forward from P5, since the two are the same underlying problem: DM mode makes "user has DMs closed" a routine failure, not an edge case, so leaving it unhandled surfaced on the very first close-DMs test.
  - Concurrency clamped to 1 in DM mode (decision 6) needed **no dedicated code at all** — it falls out for free once a user with any open ticket gets redirected instead of allowed to start a second one (see the `findOpenThreadsForUser` gate below). `guild_settings.max_concurrent_threads` is simply never consulted by the DM path.
  - **New gap found and fixed, not in the original P4/P5 split at all:** a user with an already-open _panel_-origin ticket (pre-existing before DM mode was turned on, or from a `max_concurrent_threads > 1` a panel allowed) who then DMs the bot got a second, parallel ticket opened via DM — nothing gated the DM opener flow on "does this user already have an open ticket of any origin." Fixed with `lib/threads.ts#findOpenThreadsForUser` plus a redirect-to-existing-thread reply in `handleDmMessage`, checked before the pending-opener/member/block checks.
  - **New gap found and fixed:** a blocked user could spam-DM the bot with no rate limiting, forcing a fresh `guilds.getMember` Discord API call _and_ a fresh reply on every single message. Fixed with an atomic `SET ... NX` cooldown claim (same pattern `lib/replyAlerts.ts` already uses), checked before the member fetch so a spammed blocked user costs one DB query and one Redis op per message, not two Discord API calls.
  - The DM category-select prompt was being edited in place to a leftover confirmation string instead of disappearing — fixed by deleting it and, per explicit owner feedback, sending **no** synthetic confirmation at all (not even when no greeting is configured) — the ticket's own greeting, if any, is the only confirmation.
  - What's left of P5 after all this: `lib/threadClose.ts`'s `origin` branching (skip the private-thread lock/nuke-scheduling, farewell into the DM instead) is the only remaining item with real code to write. `threadNukeSweep.ts`/`pendingTicketSweep.ts` need no changes at all — confirmed a DM-origin ticket never gets a row in either table's source tables in the first place (nuking is scheduled at close time, which doesn't handle DM tickets yet; DM openers never write `pending_tickets`). See the updated P5 section below.
  - Dashboard: the three "doesn't apply while DM mode is on" notes (`greetingBeforeOpener`, `maxConcurrentThreads`, and — added after initial review, it was missed the first time — deletion-delay/nuke) are styled as an actual warning box (border/background/icon, `ErrorBanner.tsx`'s treatment) per explicit feedback that muted gray text next to a field's own description was too easy to skim past.
- **Manually verified end-to-end this session**, three rounds, using the same-token testing trick (a `modmail_instances` row for test guild `1530909114736050316` pointing at the local dev `MODMAIL_BOT_TOKEN` itself, `modmail-bot` run with `MODMAIL_INSTANCE_ID=dev-test`) — see the P1/P2/P3 historical notes below for the recipe, unchanged. Confirmed live: DM opener → category prompt → pick → ticket created with the right tag, greeting after the relay regardless of `greetingBeforeOpener`; mid-pick nudge without relaying; zero-category guild skips straight to creation; non-member/blocked rejections; redirect to an existing open ticket instead of opening a second one; the panel button going inert while DM mode is on; `/reply-q`/`/reply` showing the distinct undeliverable-DM message with DMs closed. Did not test `/close` on a DM-origin ticket (still expected to misbehave — P5's `threadClose.ts` work).
- Environment was torn down after this session: `modmail_instances` row deleted, `guild_settings.dm_mode` reverted, the instance-scoped `modmail-bot` process stopped, and the leftover `bot:MODMAIL#dev-test` Redis key (no TTL, would otherwise have kept the dashboard treating that guild as a custom instance indefinitely) deleted. `threads`/`thread_messages` rows created by the actual DM interactions during testing were deliberately left alone — real functional data from exercising the feature, not test scaffolding.

<details>
<summary>P1/P2/P3 session notes (historical, kept for context)</summary>

- P3 added `resolveBotBranding(guild, bot)` and a `BotIcon` component to `apps/website/src/utils/bots.tsx`, consumed by `GuildCard.tsx`, `GuildNav.tsx`, `dashboard/[id]/page.tsx`'s `SectionCard` loop, and `DashboardCrumbs.tsx` (both the `modmail` segment's own label/icon and its bot-switcher dropdown options). All four read `guild.customInstanceId`/`customInstanceLabel`/`customInstanceIconUrl` from `MeGuild` (already on the wire since P2) and fall through to the static `Bots[bot]` entry whenever `customInstanceId` is `null` — a guild with no custom instance renders through the exact same code path as before P3, just via `resolveBotBranding` instead of a direct `Bots[bot]` lookup.
- `next.config.mjs`'s `images.remotePatterns` gained a second entry for `cdn.discordapp.com/app-icons/**` — the existing entry only allowed `/icons/**` (guild icons), but a custom instance's branding icon (`getInstanceBranding`'s `iconUrl`, `services/api/src/util/discordApplication.ts`) is a bot _application_ icon, a different CDN path. Without this, `next/image` throws at request time for any custom-instance guild.
- `DashboardCrumbs.tsx`'s `SegmentOptions` type gained an optional `label` field, and the render loop's `computedOptions`/`label` computation order was swapped (options computed first) so a literal (non-`:id`) segment like `modmail` can have its breadcrumb label overridden the same way its icon already could — needed because `resolveLabel` only ever fires for `:id`-shaped segments, never a plain literal one.
- **Found and fixed a real P2 bug during P3's manual verification: `services/api/src/bin.ts` never called `loadInstances()`.** Only `services/modmail-bot/src/bin.ts` did. Since `getInstanceForGuild`/`getAllInstances`/`apiForGuild` all read from the in-memory snapshot `loadInstances()` populates, the API's registry had been silently empty since P2 shipped — every custom-instance guild fell through to the public-token/no-branding path in the API no matter what was in the `modmail_instances` table. `bin.ts` now calls `loadInstances()` right after `initContext()`, mirroring the bot's boot sequence (the API never sets `MODMAIL_INSTANCE_ID`, so this only ever populates the registry, never resolves a "self" instance). **This means P2 was never actually functional in the API despite its own "implemented" status note and green test suite** — `turbo run test` doesn't boot either service, so a missing boot-time call like this has no test coverage. Worth remembering next time a phase's own doc claims done-but-unverified: the verification gap isn't just "did I click through the UI," it can hide a process never being wired up at all.
- **Manually verified end-to-end** using a same-token testing trick: a `modmail_instances` row for test guild `1530909114736050316` (`id='dev-test'`) pointing at the local dev `MODMAIL_BOT_TOKEN` itself (re-encrypted with `ENCRYPTION_KEY`), with a single `modmail-bot` process running as that instance (`MODMAIL_INSTANCE_ID=dev-test`) instead of the public one. Confirmed: bot boots and connects without crash-fasting, `bot:MODMAIL#dev-test` redis guild list populates, `/me` (after the `loadInstances()` fix) returns non-null `customInstanceId`/`customInstanceLabel` for the guild, and the dashboard guild card renders the bot's own (red) avatar with the row's label instead of the static blue ModMail icon. Nav tab/breadcrumb branding were wired the same way as the guild card but not separately eyeballed.
- **Caveat of this testing method:** since it's the same Discord application as the public bot, the icon is the bot's own real avatar (not a fabricated "different" one) and nothing about true multi-application separation (foreign-application ownership messaging, P6 resync between distinct app ids) is exercised by it. Still real Discord infrastructure end-to-end otherwise (gateway connection, CDN fetch, redis, Postgres) — good enough to trust it for what it tested. The row/process are torn down after each session that uses this trick — see the P4 status notes above for the recipe reused there.

- P1 landed on top of `main` as uncommitted/staged changes (per this repo's CLAUDE.md, work is left staged for the user to commit themselves — check `git status`/`git diff` first to see the actual current state rather than assuming P1 is or isn't merged). P2 landed the same way, on top of P1, in the same working tree.
- `packages/private/db/schema/schema.sql` has `modmail_instances`; migration `20260729085859.sql` applied to local dev Postgres; kanel types regenerated (`ModmailInstances`/`ModmailInstancesId`, exported from `@chatsift/db`).
- **Encryption reused an existing, previously-unused util instead of adding a new one.** `services/api/src/util/crypt.ts` already had a correct `encrypt`/`decrypt` (AES-256-GCM, single base64 `[iv|ciphertext|authTag]` blob) that nothing actually called — it was promoted to `packages/private/backend-core/src/lib/crypt.ts` (same function names) rather than the plan's originally-sketched `encryptSecret`/`decryptSecret`. The old `services/api` copy and its test are deleted. **If P3+ needs to encrypt/decrypt anything, use `encrypt`/`decrypt` from `@chatsift/backend-core` — don't re-invent another helper.**
- `ENCRYPTION_KEY`'s zod schema (`packages/private/backend-core/src/lib/env.ts`) now validates it actually base64-decodes to 32 bytes, not just that the string is 44 characters. `MODMAIL_INSTANCE_ID` trims and requires non-empty when present. `envSchema` itself is now exported (not just the parsed `ENV` singleton) specifically so `__tests__/env.test.ts` can `.safeParse()` variants without re-importing the module per case.
- `packages/private/backend-core/src/lib/instances.ts` (`loadInstances`/`getInstanceForGuild`/`getCustomInstanceGuildIds`/`getSelfInstance`/`getAllInstances`, the last one added in P2) is the registry snapshot the API reads from — it's already boot-loaded and 60s-refreshed, no new plumbing needed there.
- `packages/private/bot-core`'s `setGuildOwnershipFilter`/`resolveForeignOwnerLabel` (`lib/ownership.ts`) exist and are wired into `services/modmail-bot` already — those stay bot-interaction-specific, not API-request-specific. P2 did **not** add a separate guild-ownership authz gate to `isAuthed`: a partner's guild members already pass `isGuildManager` on real Discord permissions regardless of which bot is installed, so the only correctness gap was _which token/API instance_ a route's Discord calls go through — that's what `apiForGuild` below is for, not a new 403 path.
- Manually verified end-to-end against local dev (real Postgres, real `modmail-bot` process): `MODMAIL_INSTANCE_ID` pointing at a missing row crashes fast on boot; inserting a `modmail_instances` row for a real test guild (1530909114736050316) made the public bot stop relaying/sweeping there and reply "this server is served by `<label>`" on its commands/components, within the 60s refresh window. Row was deleted afterward — the table is empty on `main` again.
- `turbo run build lint test` is green across all 32 workspace packages as of this status update.

**P2 implementation notes (2026-07-29), not yet manually re-verified against a live partner guild:**

- `services/api/src/util/discordAPI.ts`: `resolveGuildAPI(botId, guildId)` (returns `{ api, cacheKey }`) and `apiForGuild(botId, guildId)` (the `api` alone) are the new entry points. Only `MODMAIL` ever resolves to a custom instance's token — `AMA` and any other bot always use their single public token, since custom instances are a ModMail-only concept. Per-instance `REST`/`API` pairs are lazily built once and cached in-process by instance id (`instanceAPIs`), same lifetime assumption P1's `services/modmail-bot` already makes (a token never changes without a redeploy). `roundRobinAPI` now resolves each pick through `apiForGuild` instead of the raw `APIMapping` — this was a real bug fix, not just a refactor: `me.ts`'s `bots` array reports `MODMAIL` for a guild owned by a custom instance too (see below), so without this fix `roundRobinAPI` would sometimes hand back the _public_ token for a partner's guild.
- Every direct `discordAPIModmail` call site (the 12 the plan named) now goes through `apiForGuild`/`resolveGuildAPI`: `blocks/listBlocks.ts`, `panels/{create,update,delete}Panel.ts`, `snippets/{create,update,delete}Snippet.ts`, `threads/listThreads.ts`, `threads/util.ts` (`resolveUser`/`resolveUserBestEffort`/`resolveMember`/`resolveAppliedTagIds`/`resolveMessageAttachments` all gained a leading `guildId` param to route correctly — every caller in `getThread.ts`/`listThreads.ts`/`getConfig.ts`/`updateConfig.ts` updated to match). `discordAPIModmail` itself still exists in `discordAPI.ts` (the public token, used internally by `resolveGuildAPI`'s fallback) but nothing outside that file references it anymore.
- `discordApplication.ts`'s `getModmailApplicationId` now takes `guildId`, keyed internally by `'public'` or the owning instance's id — a partner's bot application has its own id, distinct from the public one. Same file gained `getInstanceBranding(instance)`, returning `{ label, iconUrl }` — `label` is just the registry row's `label`, `iconUrl` comes from `applications.getCurrent()` on the instance's own token. **Cached deliberately aggressively** (tightened after the initial pass, since `/me` is already slow from its own Discord calls and branding must never add to that): an in-process `Map` (`brandingCache`, 24h TTL) is the hot path with zero per-request I/O once warm; a stale entry is still returned immediately and refreshed in the background (`refreshInBackground`, fire-and-forget, never blocks the caller); redis (`modmail:instance-branding:<id>`) is only consulted on a cold process with no in-memory entry yet, so a fresh replica doesn't have to hit Discord itself; a failed background refresh backs off 5 minutes before retrying instead of hammering Discord (or a dead/revoked partner token) on every subsequent `/me`. Only the very first request a process ever sees for a given instance (with redis also cold) pays for a synchronous Discord call.
- `guildDataCache.ts` (backs `channels.ts`/`roles.ts`/`emojis.ts`): the cache key gained a third dimension, `resolveGuildAPI`'s `cacheKey` (`'public'` or instance id), alongside the existing `(botId, guildId)`. This is what makes an instance swap (a guild moving on/off a custom instance) land on a fresh cache entry instead of serving channels/roles/emojis fetched through an application that no longer owns the guild, for up to the existing 5-minute TTL.
- `me.ts`: `MeGuild` gained `customInstanceId`/`customInstanceLabel`/`customInstanceIconUrl` (all `null` for a guild with no `modmail_instances` row). The `bots` array's `MODMAIL` membership is now a union of the public `bot:MODMAIL` redis list and every custom instance's own `bot:MODMAIL#<id>` list (`GuildList`, widened in P1) — without this a partner's guild would show no ModMail badge at all, since the public deployment's own guild list correctly stops including it once ownership is gated. Branding is resolved best-effort (a failed icon fetch logs and falls back to `iconUrl: null`, not a failed `/me`) and only for instances the caller is actually in a guild for. **The `me:` redis cache key is bumped to `me2:`** — `bin-rw`'s recipe is positional with no version marker, so a pre-existing `me:`-keyed entry would otherwise misdecode against the wider recipe. `fetchMeFromGrant` was also switched from the raw `GRANT_BOTS`/`APIMapping` pairing to `apiForGuild(bot, grant.guildId)` — this was a latent bug the plan didn't call out explicitly: `MODMAIL_SNIPPET_CREATE`/`MODMAIL_CONFIG_UPDATE`/`MODMAIL_BLOCKS_READ` grants are minted by a command running on whichever bot currently owns the guild, which for a partner is the custom instance, not the public deployment, so the old code would have 403'd every grant-authed request for a partner guild.
- **Not done, deliberately out of P2's scope per the plan:** dashboard branding consumption (P3), DM mode (P4/P5), resync (P6). `apps/website` was not touched at all in P2 — the new `customInstance*` fields exist on the API response but nothing renders them yet.
- **Not yet manually verified.** Everything above is `turbo run build lint test` green (151 tests, no type errors) but has not been exercised against a real second bot application / partner guild the way P1 was — that needs a second real Discord application token to insert into `modmail_instances` locally and a dashboard session for a test guild, which wasn't set up in this session. Treat the P2 code as implemented-but-unverified until that manual pass happens.

</details>

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

The token column stores a base64 `[iv | ciphertext | authTag]` blob; `packages/private/backend-core`'s `encrypt`/`decrypt` (`lib/crypt.ts`) handle it — this already existed, promoted up from `services/api/src/util/crypt.ts` (previously unused there) rather than adding a second AES-256-GCM helper with its own serialization. If the team would rather not encrypt, the alternative is plaintext plus a note that DB dumps become credential material — but the encrypted path is a few dozen lines and `ENCRYPTION_KEY` already exists, so it's the recommendation.

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

**Why `user_thread_id` (now `user_channel_id`, renamed at P4 implementation time) holds the DM channel id.** A DM channel id is stable per (user, bot application) pair, so storing it there makes `findOpenThreadByUserChannelId` (the user→mod relay lookup), `relayStaffReplyToUserThread` (which posts to `thread.userChannelId`), and the whole `userMessageLifecycle` edit/delete sync work in DM mode with **zero changes**. That's the single biggest reason DM mode isn't a fork of the relay layer. The cost is that a raw `user_channel_id` value no longer tells you what kind of channel it is, which is precisely what `origin` is for — and every place that treats it as a manipulable thread (`closeThread`'s lock, `threadNukeSweep`, `preventThreadArchive`) must branch on `origin`, not on truthiness.

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

### P1 — Registry table + ownership gating (bot side) — done 2026-07-29

- `packages/private/db`: `modmail_instances` table, Atlas migration, kanel regen.
- `packages/private/backend-core`: `lib/instances.ts` (above); `lib/crypt.ts`'s `encrypt`/`decrypt`, promoted from `services/api/src/util/crypt.ts` (see above); `ENV.MODMAIL_INSTANCE_ID` (optional); `GuildList` key type widening in `lib/data/bots.ts`.
- `services/modmail-bot/src/bin.ts`: resolve self-instance → token and `botId` (`MODMAIL` or `MODMAIL#<id>`); add the `DirectMessages` intent (harmless for the public deployment, required later by P4); fail fast on an unresolvable `MODMAIL_INSTANCE_ID`.
- `services/modmail-bot/src/lib/instance.ts` (new): `ownsGuild(guildId)` plus the SQL scope fragment the sweeps use.
- Gate the three raw listeners in `services/modmail-bot/src/index.ts` (`registerMessageRelay`, both halves of `registerMessageLifecycleRelay`).
- Scope all four sweeps: `lib/pendingTicketSweep.ts`, `lib/scheduledCloseSweep.ts`, `lib/threadNukeSweep.ts`, `lib/preventThreadArchive.ts`.
- `packages/private/bot-core`: optional `setGuildOwnershipFilter(fn)` hook consulted by `handleCommandInteraction`/`handleComponentInteraction`/`handleAutocompleteInteraction`, so an unowned guild's leftover commands answer with "this server is served by <label>" instead of acting on shared rows.

_Verify:_ public bot in a guild that has a registry row ignores every message event and sweeps nothing for it; the same guild with the row removed goes back to normal within one refresh interval. **Done** — verified manually against local dev with a real `modmail-bot` process and test guild 1530909114736050316; see the status note at the top of this doc.

### P2 — Instance-aware API — implemented 2026-07-29, boot-sequence bug fixed and core path manually verified 2026-07-29

- `services/api/src/util/discordAPI.ts`: `apiForGuild(botId, guildId)`, backed by a lazily-built per-instance `REST`/`API` pair; `roundRobinAPI` resolves through it.
- Replace every direct `discordAPIModmail` use: `util/discordApplication.ts` (`getModmailApplicationId(guildId)`, memoized per instance), `routes/modmail/blocks/listBlocks.ts`, `routes/modmail/snippets/{create,update,delete}Snippet.ts`, `routes/modmail/panels/{create,update,delete}Panel.ts`, `routes/modmail/threads/{listThreads,util}.ts`.
- `util/channels.ts`, `util/roles.ts`, `util/emojis.ts`, `util/guildDataCache.ts`: the `(botId, guildId)` cache partition gains the instance id, since two applications in one guild genuinely see different channel sets.
- `util/me.ts`: union the per-instance guild lists; add `customInstanceId`/`customInstanceLabel`/`customInstanceIconUrl` to `MeGuild`. **The `me:` Redis key prefix must be bumped** — bin-rw recipes are positional and there is no version marker in `RedisStore`, so pre-existing cached entries would misdecode against the new recipe for up to the 5-minute TTL.
- The instance's avatar/label come from `applications.getCurrent()` on the instance token, cached in Redis.
- **`services/api/src/bin.ts` must call `loadInstances()` after `initContext()`.** This was missing from P2 as originally shipped — every piece above reads from the in-memory registry `loadInstances()` populates, but only `services/modmail-bot/src/bin.ts` called it, so the API's registry was permanently empty and every guild silently resolved as "no custom instance" regardless of the `modmail_instances` table's contents. Fixed 2026-07-29 during P3's manual verification pass (see status section above).

_Verify:_ a partner guild with only the custom bot present loads the full ModMail dashboard — config, categories, panels, snippets, blocks, thread history — with no 403s. **`/me`'s `customInstanceId` confirmed non-null for a real registry row after the boot-sequence fix above** (2026-07-29, same-token testing recipe); the full per-route sweep (config/categories/panels/snippets/blocks/threads all working end-to-end for a partner guild with no 403s) has still not been individually exercised.

### P3 — Dashboard branding — implemented and manually verified 2026-07-29

- `apps/website/src/utils/bots.tsx`: `resolveBotBranding(guild, bot)` returns `{ label, iconUrl }` — the static `Bots[bot].label`/`iconUrl: null` unless `bot === 'MODMAIL'` and `guild.customInstanceId` is set, in which case `label`/`iconUrl` come from `guild.customInstanceLabel`/`customInstanceIconUrl`. A new `BotIcon` component renders a `next/image` from `iconUrl` when present, else the bot's static SVG — one render helper instead of duplicating the branch at every call site.
- Consumed in `app/dashboard/_components/GuildCard.tsx`, `app/dashboard/[id]/_components/GuildNav.tsx`, `app/dashboard/[id]/page.tsx` (`SectionCard` loop), and `components/dashboard/DashboardCrumbs.tsx` — both the `modmail` segment's own crumb (label + icon) and its bot-switcher dropdown options branch on the current guild's branding.
- `next.config.mjs` gained an `images.remotePatterns` entry for `cdn.discordapp.com/app-icons/**` (a bot application icon, not a guild icon — the existing `/icons/**` entry doesn't cover it); without it `next/image` throws for any custom-instance guild.
- Routes stay `/dashboard/[id]/modmail` — identical pages, different chrome (decision 5).
- A guild with no custom instance renders through the same `resolveBotBranding` call but takes the `customInstanceId === null` branch, which reproduces the pre-P3 output exactly — no behavior change for the public path.

_Verify:_ partner guild shows the custom avatar and label on the guild card, nav tab, section card and breadcrumbs; a normal guild is unchanged; a user in both sees each correctly. **Guild card confirmed live** — see the same-token testing recipe in the status section above; the guild card rendered the test instance's real avatar and `'TEST INSTANCE (dev)'` label correctly, which also proves the `loadInstances()` API boot-sequence bug (same section) is fixed. Nav tab/section card/breadcrumb branding share the exact same `resolveBotBranding`/`BotIcon` call as the guild card, so this is very likely fine everywhere, but they weren't individually eyeballed. The no-custom-instance path is unaffected (existing dashboard guilds kept rendering normally throughout this session with the API and website dev servers already running).

### P4 — DM mode: schema, config surface, opener flow — implemented + manually verified 2026-07-29

- `packages/private/db`: `guild_settings.dm_mode`, `threads.origin` + check constraint, **`threads.user_thread_id` renamed to `user_channel_id`** (see the status section above for why and for the migration hand-fix), migration, kanel regen.
- `services/api`: `dmMode` in the modmail config get/update schemas, rejected with a 400 when the guild has no `modmail_instances` row.
- `apps/website`: DM-mode toggle in `ModmailConfigForm`, rendered only for a custom-instance guild; a warning-styled (not just muted text) caveat on `greeting_before_opener`, `max_concurrent_threads`, _and_ the deletion-delay/nuke toggle, all explaining they don't apply while it's on; an informational banner on the panels page.
- `services/modmail-bot/src/lib/dmTicket.ts` (new): opener detection, membership + block checks (block check moved ahead of the member fetch, with a claimed cooldown — see below), category prompt, pending state (`DmPendingOpenerStore`), nudge path, and the existing-open-ticket redirect (`findOpenThreadsForUser` in `lib/threads.ts`).
- `services/modmail-bot/src/components/dmCategorySelect.ts` (new): resolves guild from the self-instance (DM interactions carry no `guild_id` and no `member`), re-fetches the stashed opener, creates the ticket. Deletes its own prompt message on every outcome instead of editing it in place; sends no synthetic confirmation on success at all (the ticket's greeting, if any, is the only confirmation).
- `services/modmail-bot/src/lib/ticketCreation.ts`: `finishTicketCreation` gained an `origin` param (`'panel'`/`'dm'`) and its `privateThreadId` option was renamed `userChannelId`; DM callers fetch the guild member explicitly (a DM `MESSAGE_CREATE` carries no `member`, which the opening embed's roles/join-date fields need); greeting always posts after the relay in DM mode, ignoring `greetingBeforeOpener`.
- `services/modmail-bot/src/index.ts`: route DM messages (`guild_id` absent) into `handleDmMessage`, after the existing thread/mod-thread/pending-ticket lookups find nothing.
- `services/modmail-bot/src/lib/preventThreadArchive.ts`: `origin != 'dm'` filter added to its query, so it never issues a wasted `channels.get` for a DM-origin ticket's `user_channel_id` (a DM channel never has `thread_metadata` to unarchive).
- Pulled forward from P5's originally-planned scope (see the status section above for why): `createTicket.ts`/`categorySelect.ts` inert-while-DM-mode guard (decision 9); `lib/relay.ts`'s resequencing + `UndeliverableUserError`; all four relay call sites surfacing the undeliverable-DM message; the concurrency-1 cap (free, via the existing-ticket redirect, no dedicated enforcement code).
- New, not in the original phase split at all: the existing-open-ticket redirect (`findOpenThreadsForUser`) and the blocked-user DM-spam cooldown (`BLOCKED_NOTICE_COOLDOWN_MS`, atomic `SET ... NX` claim in `lib/dmTicket.ts`, mirroring `lib/replyAlerts.ts`'s pattern).

_Verify:_ DM opener → category prompt → pick → mod-forum thread with the right tag → opener relayed → greeting after (regardless of `greetingBeforeOpener`); a mid-pick message gets the nudge and is not relayed; a no-category guild skips straight to thread creation; a blocked user and a non-member are both rejected; a user with an already-open ticket gets redirected instead of opening a second one; a blocked user spamming DMs only costs one Discord API call per cooldown window, not per message. **All confirmed live** this session against the same-token test guild — see the status section above.

### P5 — DM-mode divergences and error surfaces — implemented + manually verified 2026-07-30

Most of this phase's originally-planned scope shipped as part of P4 already (see the status section above) — what was left:

- `lib/threadClose.ts`: `origin = 'dm'` skips the private-thread lock and never schedules a nuke; the farewell posts into the DM (unchanged — it already worked for both origins, since `userChannelId` holds the DM channel id regardless). **Done** — the whole lock+nuke block is now wrapped in `if (thread.origin !== 'dm')`.
- ~~`lib/threadNukeSweep.ts`, `lib/pendingTicketSweep.ts`: skip DM-origin threads.~~ Confirmed during P4 that neither needs any change: a DM-origin ticket never gets a row in `scheduled_thread_nukes` (nuking is scheduled at close time, which doesn't handle DM tickets until the item above lands) or `pending_tickets` (DM openers never write one at all, decision 8) in the first place.
- ~~`lib/preventThreadArchive.ts`: skip DM-origin threads.~~ Done in P4 (`origin != 'dm'` filter).
- ~~`lib/relay.ts`: resequence user-copy-before-log-copy; typed `UndeliverableUserError`.~~ Done in P4.
- ~~`commands/reply.ts`, `commands/replyQuick.ts`, `lib/replyContextMenu.ts` (both context menus) and the snippet resolver in `index.ts`: surface the undeliverable-DM message.~~ Done in P4. (`replyQuick.ts` also gained the `defer`+try/catch it was missing entirely — a real "did not respond" bug found live, not just the undeliverable-message polish.)
- ~~`components/createTicket.ts`: inert redirect reply while DM mode is on (decision 9).~~ Done in P4, plus the same guard added to `categorySelect.ts` for defense-in-depth.
- ~~Concurrency clamped to 1 in DM mode regardless of `max_concurrent_threads`.~~ Done in P4, as a free side effect of the existing-open-ticket redirect — no dedicated enforcement code was needed.

_Verify:_ close a DM ticket (farewell delivered, no lock/nuke attempted, mod thread archived). **Done** — confirmed live 2026-07-30, see the status section above.

### P6 — Resync + operations — implemented + smoke-tested 2026-07-30

- `POST /v3/guilds/:guildId/modmail/resync` (`services/api/src/routes/modmail/resync.ts`; guild manager, or global admin — `isGuildManager: true` already admin-bypasses per `isAuthed.ts`, no separate branch needed): for every snippet, checks whether its stored `command_id` still resolves under the _currently owning_ application (`apiForGuild`/`getModmailApplicationId`, registry-driven) via `getGuildCommand` — a `10063 UnknownApplicationCommand` there is exactly the "this predates the current owner" signal, since Discord command ids are application-scoped, so nothing needs to track which application used to own the guild. On a miss, creates a fresh guild command and rewrites `snippets.command_id`. Afterwards, lists every guild command actually registered under the current application and deletes any that don't back a live snippet (`staleCommandsDeleted`) — an orphan from a deleted snippet, or from an earlier stint under this same application before a swap-away-and-back. Panels use the equivalent signal one layer down: `editMessage` on the stored `message_id` fails with `50005 CannotEditMessageAuthoredByAnotherUser` (or `10008 UnknownMessage` if it's gone) when the message belongs to a different application; a successful edit means it's already correct. On a miss, the button's label is read back off the live message first (`panel_json_data` only ever stored the embed/content, never the button — see `createPanel.ts`), then a new message is posted and `ticket_panels.message_id` rewritten, with a best-effort delete of the old message (works if the current application happens to hold Manage Messages in that channel even though it isn't the author; otherwise the old message just sits there answering "served by `<label>`" per P1's ownership filter until removed by hand).
- Dashboard: a "Resync" card in `ModmailConfigForm.tsx`, shown when `canResync` (`isCustomInstance || me.isGlobalAdmin`) — a global admin can reach it for any guild, since they're the one actually performing a swap and may not otherwise manage that guild day-to-day. Reports counts back (`snippetsRecreated`/`staleCommandsDeleted`/`panelsReposted`) and invalidates both the panels and snippets queries on success, since a recreated command/reposted panel changes `commandId`/`messageId` that the list views don't otherwise know to refetch.
- `docker-compose.yml`: a commented-out `modmail-bot-<partner-slug>` template block after the public `modmail-bot` service — same image/build/env-file shape, `MODMAIL_INSTANCE_ID` is the only addition.
- `docs/workflow.md`: onboarding/offboarding runbook (`## Custom ModMail instances (#216)`) — insert the row first, wait for the 60s refresh, start the service, resync, verify; reverse order to offboard, **with one real asymmetry the original phase framing didn't anticipate**: resync always targets whichever application the registry says _currently_ owns the guild. Onboarding runs it once (row already points at the new partner). Offboarding needs it twice — once before deleting the row (so the partner's application can still clean up what it can reach) and once after (now that the guild resolves back to public, to actually recreate/repost onto it) — a single resync click doesn't cover a swap in this direction the same way it does the other.

_Verify:_ move a test guild from the public instance to a custom one and back; after each swap, resync restores working `/snippet` commands and a clickable panel. **Partially done** — smoke-tested directly against the route handler (bypassing HTTP/auth) with real DB/Discord calls: the no-op path, the snippet recreate + stale-command-delete path (via a deliberately-bogus `command_id` and a real orphan command), and the panel repost path (via a genuinely deleted message, `10008 UnknownMessage`) all confirmed correct on Discord's side. **Still needs a second real Discord application token** to exercise the `50005 CannotEditMessageAuthoredByAnotherUser` branch and non-default label preservation off a still-live foreign message — the same-token trick can't produce a genuinely foreign-authored-but-still-live message. `turbo run build lint test` green (151 tests) — see the status section above for the full smoke-test writeup.

## Risks and known sharp edges

- **Onboarding order matters.** The public bot stops acting on a guild within 60s of the row appearing. Insert the row before starting the custom deployment and that window is never live; do it the other way around and both bots briefly relay.
- **Tokens for partner bots live in the main stack's database.** Unavoidable given decision 2 — the API must be able to act _as_ the partner's bot to post panels and mint snippet commands. Encrypted at rest; the encryption key stays in `.env.private`.
- **A swap orphans application-scoped objects.** Snippet commands and panel messages belong to the application that created them. P6's resync is the answer; until it runs, a swapped guild has dead `/snippet` commands and a panel whose button dispatches to a bot that no longer owns the guild (and which, thanks to P1's ownership filter, answers with the "served by <label>" message rather than doing something wrong).
- **`origin` is the only thing distinguishing a DM channel from a private thread** in `user_channel_id` (renamed from `user_thread_id` in P4 — see the status section). Any future code path that locks, archives or deletes `user_channel_id` must branch on it. `lib/threadClose.ts` now does (P5, done); every sweep already either filters `origin` (`preventThreadArchive.ts`) or is structurally unaffected (`threadNukeSweep.ts`/`pendingTicketSweep.ts`, confirmed in P4).
- **DM mode ignores real settings.** `greeting_before_opener` and `max_concurrent_threads` remain editable and visibly do nothing (decision 6) — `max_concurrent_threads` is enforced regardless, but implicitly (the existing-open-ticket redirect never consults it), not by reading and comparing against the setting. Both, plus the deletion-delay/nuke toggle, now show a warning-styled caveat in the dashboard (P4), not just quiet muted text — the tooltip-only mitigation from the original plan wasn't enough on its own, per live feedback during P4.

## Explicitly out of scope

- Self-serve or dashboard-driven instance provisioning (decision 1).
- Custom instances of AMA, or of any product other than ModMail.
- Per-instance schema, data partitioning, or any migration when moving a partner between instances (decision 2 is what buys this).
- Automatic reconciliation of snippet commands/panels on boot — rejected in favor of the explicit button (decision 10).
