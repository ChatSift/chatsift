# M5 — ModMail: legacy data migration + cutover

**Milestone target:** the freeze window opens **2026-08-24T15:00:00Z** and the migration runs at **2026-08-26T15:00:00Z** (both 18:00 EEST) — announced to guild owners, so this is now a public commitment, not an internal aim. See [Pre-cutover comms](#pre-cutover-comms-313) for who was told what. **Depends on:** nothing blocking — the M1 foundation pattern and the M4-established bot/grant-token conventions this milestone originally depended on have both already shipped and been reused (see below). **Live production impact:** yes, and unlike M4 this one includes a real historical-data migration.

## Status: freeze in effect since 2026-08-24T15:00:00Z; migration + cutover 2026-08-26T15:00:00Z

M5 was redesigned 2026-07-22 (from a straight DM-based port into a ticket/private-thread system — rationale below) and, as of that redesign, fully implemented: schema, API, dashboard, and bot, plus two follow-on efforts built on top of it — the thread-history dashboard view (#261) and custom instances + DM mode (#216). None of that is a plan anymore; it's documented as current-state architecture in [01-architecture.md §6a](01-architecture.md#6a-modmail-bot-subsystem-servicesmodmail-bot-m5) (base ticket system), [§7](01-architecture.md#7-modmail-thread-history-dashboard-view-261) (thread history), and [§8](01-architecture.md#8-custom-modmail-instances-216) (custom instances/DM mode). This doc is no longer a design spec — it's scoped down to the one thing still outstanding: migrating real historical thread data out of legacy `ChatSift/ModMail` and cutting the **public** deployment over to `services/modmail-bot`.

**Why this hasn't happened yet, despite `services/modmail-bot` already being live:** custom instances (#216) put the new bot into real production use back on 2026-07-30, but only for partner guilds — those are guilds with no prior history, so there was nothing to migrate. The public deployment is the harder case: it's the one legacy `ChatSift/ModMail` still serves today, with years of real thread history that has to survive the swap intact. That's the entire remaining scope of this milestone.

## Why the redesign: DMing the bot was killed

Direct quote from the design discussion (2026-07-22), owner's framing:

> "I think we should kill DMing the bot, it's pretty terrible lmao. My idea is to have staff teams set up a prompt just like AMA, and as the user you click the button and get a private thread within the server anyway where you type, and on the mod end it looks the exact same. Its totally ok because only server admins can technically peek into that private thread, so it's still very privacy isolated. One 'downside' is it's potentially messier to allow the user to revisit conversations with the mod team — maybe you want to completely nuke their perspective sometime after the thread is closed. I'd imagine more people are more on that end. I guess in a sense this makes it more of a ticket bot than a modmail, but I think this is the superior model anyway."

**The mod side didn't change.** A ticket still lands as a post in the mod-side forum with a running message history, exactly like the old `Thread`/`ThreadMessage` model. Only the user-facing origin changed: an in-server private thread (or, for a custom instance opted into DM mode, still a DM — see [01-architecture.md §8](01-architecture.md#8-custom-modmail-instances-216)) instead of every guild being DM-only. This is why the old schema below is still the migration source for the public deployment, not a from-scratch design — the new schema is the old one plus a handful of new concepts (categories, panels, an origin distinction) layered on top. Full design-outline/build narrative for the create-flow, the mention/user-ID QOL feature, and the schema-authoring decisions lives in git history (this doc's pre-2026-07-30 revisions) and in closed issue #152, not here — [01-architecture.md §6a](01-architecture.md#6a-modmail-bot-subsystem-servicesmodmail-bot-m5) has the shipped shape.

## Old schema (migration source)

From legacy `ChatSift/ModMail`'s `prisma/schema.prisma` (captured 2026-07-16):

```prisma
model GuildSettings {
  guildId          String  @id
  modmailChannelId String?
  greetingMessage  String?
  farewellMessage  String?
  simpleMode       Boolean @default(false)
  alertRoleId      String?
}

model SnippetUpdates {
  snippetUpdateId Int      @id @default(autoincrement())
  snippetId       Int
  snippet         Snippet  @relation(fields: [snippetId], references: [snippetId], onDelete: Cascade)
  updatedAt       DateTime @default(now())
  updatedBy       String
  oldContent      String
}

model Snippet {
  snippetId     Int              @id @default(autoincrement())
  guildId       String
  commandId     String
  createdById   String
  name          String
  content       String
  timesUsed     Int              @default(0)
  lastUsedAt    DateTime?        @db.Timestamptz()
  createdAt     DateTime         @default(now()) @db.Timestamptz()
  lastUpdatedAt DateTime         @updatedAt @db.Timestamptz()
  updates       SnippetUpdates[]
  @@unique([guildId, name])
}

model ScheduledThreadClose {
  threadId      Int      @id
  thread        Thread   @relation(fields: [threadId], references: [threadId], onDelete: Cascade)
  scheduledById String
  silent        Boolean  @default(false)
  closeAt       DateTime
}

model ThreadMessage {
  threadMessageId      Int     @id @default(autoincrement())
  localThreadMessageId Int
  guildId              String
  threadId             Int
  thread               Thread  @relation(fields: [threadId], references: [threadId], onDelete: Cascade)
  userId               String
  userMessageId        String
  staffId              String?
  guildMessageId       String
  anon                 Boolean @default(false)
  @@unique([threadId, localThreadMessageId])
}

model Thread {
  threadId                 Int                   @id @default(autoincrement())
  guildId                  String
  channelId                String
  userId                   String
  createdById              String
  createdAt                DateTime              @default(now()) @db.Timestamptz()
  closedById               String?
  closedAt                 DateTime?             @db.Timestamptz()
  scheduledClose           ScheduledThreadClose?
  lastLocalThreadMessageId Int                   @default(0)
  messages                 ThreadMessage[]
  alerts                   ThreadReplyAlert[]
}

model Block {
  userId    String
  guildId   String
  expiresAt DateTime?
  @@id([userId, guildId])
}

model ThreadOpenAlert {
  guildId String
  userId  String
  @@id([guildId, userId])
}

model ThreadReplyAlert {
  threadId Int
  thread   Thread @relation(fields: [threadId], references: [threadId], onDelete: Cascade)
  userId   String
  @@id([threadId, userId])
}
```

## Schema mapping (old → new)

Because the mod-side model didn't change, this is a close-to-1:1 mapping, not the divergent-schema situation AMA was in ([05-migration-cutover.md](05-migration-cutover.md)) — see [01-architecture.md §6a](01-architecture.md#6a-modmail-bot-subsystem-servicesmodmail-bot-m5) for the actual current column names:

- `Thread` → `threads`: `channelId` → `mod_thread_id` (rename only). `category_id` and `user_channel_id` are both `NULL` on every migrated row — correct, since a legacy thread has no category concept and its DM channel isn't something the new bot should ever lock/nuke (it was never a private thread it created). `origin` defaults to `'panel'` at the column level, but a migrated row is written as `'dm'` since that's what it historically was. (There is no #216 precedent to copy here, despite what §8 used to imply — that migration added the column with a plain default and never backfilled anything, because there were no rows to backfill.) This is load-bearing, not cosmetic: `lib/preventThreadArchive.ts` selects `WHERE closed_at IS NULL AND origin != 'dm'` and force-stamps `closed_at = now()` on any row whose `mod_thread_id` 404s.
- `ThreadMessage` → `thread_messages`: maps 1:1 (`userMessageId`/`guildMessageId`/`staffId`/`anon` unchanged in shape). `is_internal`/`is_system`/`deleted_at` (added for #261) are all `false`/`NULL` for migrated rows — none of that context exists for historical data, and that's an accurate "not recorded" state, not a gap to backfill.
- `Block`, `Snippet`+`SnippetUpdates`, `ScheduledThreadClose`, `ThreadOpenAlert`, `ThreadReplyAlert` — map 1:1 onto `blocks`, `snippets`+`snippet_updates`, `scheduled_thread_closes`, `thread_open_alerts`, `thread_reply_alerts`.
- `GuildSettings` → `guild_settings`: `greetingMessage` → `default_greeting_message`, `farewellMessage`/`simpleMode`/`alertRoleId` direct. **`modmailChannelId` is dropped — `mod_forum_id` is written as `NULL` for every guild, unconditionally** (see item 1 under "Remaining scope"). The new mod side requires a Forum for tag-based category routing, legacy's value was a plain text channel, and nothing at the DB or bot layer validates that (only `services/api`'s `updateConfig.ts` checks `ChannelType.GuildForum`, which a direct SQL insert bypasses) — so carrying the old id over would produce a config that inserts cleanly and then fails at first ticket creation. `NULL` leaves the guild visibly unconfigured instead. Picking a real forum is a manual, per-guild admin step on the dashboard afterwards; the script prints the list of affected guilds so it can drive follow-up comms. `simple_mode` carries over for fidelity but is inert — nothing in `services/modmail-bot` reads it.
- No `thread_message_content` rows are created for migrated messages (content recording, #261, didn't exist historically) — the dashboard thread view already renders a "not recorded" placeholder for exactly this case, so this needs no special handling in the script.

## Remaining scope

1. ~~**Write a migration script**~~ — done (#157): `packages/private/db/src/scripts/migrateLegacyModmail.ts`, run via `yarn migrate:legacy-modmail --source <slug> --dry-run|--live|--verify` with `LEGACY_DATABASE_URL` pointing at a restored copy of the legacy database. Transforms all 9 legacy tables per the mapping above, preserving relations and timestamps exactly. **Integer PKs are regenerated, not preserved** — the new database already holds partner-instance rows, so legacy ids would collide; ids come off each table's identity sequence via `nextval`, which also means no `setval()` fixup afterwards. Four things worth knowing before running it:
   - **`--source <slug>` is required**, and names the legacy deployment being migrated (`nascar`, `public`, …). It is written to `threads.migration_source` and is what scopes both the re-run guard and every target-side `--verify` count. This exists because the public `ChatSift/ModMail` deployment is _not_ the only legacy database — partners self-host their own copies (see the NASCAR pilot below), and migrating one must not wedge or miscount another. The script originally identified its own rows by inferring `origin = 'dm' AND user_channel_id IS NULL`, which is global: one partner migration would have made every later run, including the public cutover, abort as a "re-run" — and the abort's suggested `DELETE` would have destroyed that partner's freshly migrated history.
   - It **refuses to run while any legacy thread is still open**. Force-closing them is a deliberate runbook step (item 3 below), not something the script does silently.
   - It **refuses to run twice for the same `--source`**. Thread history is not idempotent — `threads` has no unique key to conflict on, so a second pass would duplicate every ticket. Starting over means deleting that source's migrated rows by hand first; the abort message carries the exact statement, scoped to the slug. A _different_ `--source` is deliberately allowed to proceed.
   - `mod_forum_id` is migrated as `NULL` for every guild, deliberately: the legacy value was a text channel and the new mod side needs a Forum. The script prints the list of affected guilds so it can drive follow-up comms.
2. **Dry-run against a restored copy of the _public_ production database** — **still outstanding, and now the largest unknown left in this milestone.** The NASCAR pilot below is complete end to end, which is what closed #158, but it measured a two-guild partner database; the public deployment is a **2,460-guild** application (`GET /applications/@me`, 2026-08-24) whose row counts nobody has ever counted. The pilot's "~1 second" is not transferable — it is the number for 271 threads and 1,289 messages. Getting a real wall-clock figure for the public dataset is the top job of the freeze window, because it is what sizes the 2026-08-26 maintenance window.
3. **Cutover runbook** — written up as [Public cutover runbook (#159)](#public-cutover-runbook-159) below, informed by the pilot rather than mirroring [05-migration-cutover.md](05-migration-cutover.md) (which had no data migration to sequence).

## Pre-cutover comms (#313)

Three separate measures, all driven off **one instant**: `2026-08-24T15:00:00Z` (Mon 24 Aug 2026, 18:00 EEST), with the freeze running 48h to `2026-08-26T15:00:00Z`. If that date ever moves, all three have to move together — owners and moderators looking at two different dates is worse than either date being wrong.

1. **Owner DMs** — [`scripts/announce-modmail-migration.mjs`](../../scripts/announce-modmail-migration.mjs) in this repo. Dependency-free node-builtins script (it runs on a deploy host with no installed workspace, same constraint as the other root scripts), plain REST `POST /users/@me/channels` + `POST /channels/:id/messages`, Components V2 body. Recipients are a **hardcoded 21-entry `OWNERS` list** sourced from the prod ModMail guild-activity table — filtered by _actual bot usage_, not member count, so large-but-idle guilds are deliberately absent. Repeated owner ids are folded into one DM naming every guild they own. Requires `MODMAIL_ANNOUNCE_TOKEN` (the legacy prod bot's token, so the DM comes from the bot the owner recognises) plus an explicit `--test` (one recipient — us, labelled as a fake "ChatSift" guild) or `--live` — there is no default, so a bare invocation can't blast real owners. The date is **hardcoded** in the script now that it's settled, not passed in; `MIGRATION_START_ISO` still overrides it but is rejected without an explicit `Z`/offset, because `Date` would otherwise parse it in the runner's local timezone and silently shift every `<t:…>` the recipients see. Every run prints the resolved window before sending anything:

   ```sh
   # __PROD_MODMAIL_TOK__ from .env.private -- NOT __PROD_AMA_TOK__, which sits right above it and
   # would put the announcement in front of owners as a DM from the AMA bot they never installed.
   MODMAIL_ANNOUNCE_TOKEN=$__PROD_MODMAIL_TOK__ node scripts/announce-modmail-migration.mjs --test   # then --live
   ```

   **NASCAR is deliberately absent** from both `OWNERS` and the test recipient: they're the pilot (below), moving onto their own #216 custom instance in DM mode, so this announcement's copy — public cutover date, panel-configuration requirement — is simply not true for them.

2. **Legacy bot status** — a custom presence on the legacy bot spelling out the date (Discord doesn't render `<t:…>` in a presence). Set on `ClientReady` **and re-applied hourly on a `setInterval`**: Discord drops a bot's presence over time and across gateway resumes, so a one-shot `setPresence()` (or an IDENTIFY-payload presence) quietly decays to nothing.

3. **In-thread moderator notice** — a yellow notice embed prepended to the starter message of every newly opened legacy thread, ahead of the existing info embed. This is the measure that actually reaches the people running the queue: the owner DMs above reach 21 accounts, and moderators aren't among them. It rides the existing starter message rather than being a follow-up post, so it's genuinely the first thing in the thread and costs no extra API call; the starter message's `content` (member mention + alert-role ping) is untouched, so it adds no second ping.

(2) and (3) live in **legacy `ChatSift/ModMail`**, not in this repo — they only make sense on the bot people are using today. Branch `feat/migration-notices` there: a disposable `packages/bot/src/util/migrationNotice.ts` holding the timestamps, the status text and the embed builder, wired into `events/ready.ts` and `util/handleThreadManagement.ts`. Everything is hardcoded rather than plumbed through that repo's `struct/Env.ts` on purpose — it has a known expiry date. Merging to `main` there triggers `.github/workflows/deploy.yml`, which builds and pushes `chatsift/modmail:latest`; the prod stack then needs a pull + restart to pick it up. Deploy well ahead of the 24th, and delete both call sites after cutover (or just decommission the legacy deployment, #159).

## The NASCAR pilot — complete

**The pilot ran end to end and NASCAR is live on the new stack**: `--live` + `--verify`, the #216 instance row, DM mode, a chosen forum and a snippets resync are all done. Steps 0-9 below are kept as the executed record, because the public run repeats most of them at ~2,460× the guild count and every deviation matters. Two of them do **not** carry over — see [Public cutover runbook](#public-cutover-runbook-159).

NASCAR self-hosts its own deployment of legacy `ChatSift/ModMail` (VPS checkout `/home/deploys/repos/nascar-modmail`) against its own Postgres. That makes it the rehearsal this milestone has been missing: a real legacy database with real history, small enough that a bad outcome is recoverable. Their new home is the **canary/main deployment** (`/home/deploys/repos/canary`); the `prod` branch runs no `modmail-bot` at all and folds into canary on 2026-08-13 ([prod-branch.md](../prod-branch.md)), so this was never a real choice. Afterwards they get a #216 custom instance in DM mode, so their users' flow matches what they have today.

Measured by dry-run 2026-08-11 (guild `877239953174691910`): **271 threads, 1289 messages, 1 `guild_settings` row** once the dead test guild below is removed — and **zero** snippets, snippet-updates, blocks, thread-open-alerts, thread-reply-alerts and scheduled-closes. Only three of the nine tables carry data; the rest of the script is a no-op for them. So the Snippets resync in step 8 is moot, and `threads` plus `guild_settings` are the only roots a rollback would have to touch.

**The migration itself takes ~1 second** (2.8s wall-clock, of which 1.75s was the turbo build). The maintenance window is sized entirely by the human steps — dump, restore, test-guild delete, instance onboarding, forum config — not by the migration. Do not budget a long freeze on its account.

**0. Confirm their legacy schema hasn't drifted.** Every query in the script uses quoted camelCase legacy column names, so drift from the schema captured above is a hard mid-run failure. `pg_dump --schema-only` their database and diff the nine tables against ["Old schema"](#old-schema-migration-source) before anything else. A tenth table in the dump is Prisma's own `_prisma_migrations` ledger, which the script never reads.

**1. Restore a copy, then drop the dead test guild.** Point `LEGACY_DATABASE_URL` at a restored copy, never their live database — the script holds one transaction open across reads of the legacy side. Restoring it into canary's own Postgres as a separate database (`nascar_trial`) keeps everything in one container with no cross-stack networking.

Their database holds **two** guilds, not one, and every `migrate*` function copies its table wholesale — so the second one rides along into canary unless it's removed first. It was confirmed dead on 2026-08-11 (`GET /guilds/:id` under their bot token 404s: the bot isn't in it anymore). Delete it from the _copy_ rather than filtering in the script — same effect, no code change, and it re-applies unchanged to each fresh dump:

```sql
BEGIN;
DELETE FROM "Thread"          WHERE "guildId" = '<test guild id>';  -- cascades messages/alerts/closes
DELETE FROM "GuildSettings"   WHERE "guildId" = '<test guild id>';
DELETE FROM "Block"           WHERE "guildId" = '<test guild id>';
DELETE FROM "ThreadOpenAlert" WHERE "guildId" = '<test guild id>';
DELETE FROM "Snippet"         WHERE "guildId" = '<test guild id>';
COMMIT;
```

**Every fresh dump contains it again** — re-run this before each migration attempt, and re-take the baseline counts afterwards so they match what the script will actually read. Confirm `GuildSettings` is down to 1 before continuing.

**2. Freeze.** Their legacy bot is DM-based; stop it accepting new threads/replies for the window.

**3. Force-close open threads.** Preflight refuses to run otherwise, deliberately. For a rehearsal ahead of the freeze, do it in the copy (`UPDATE "Thread" SET "closedAt" = now(), "closedById" = '<id>' WHERE "closedAt" IS NULL`) — that is itself a faithful rehearsal of the real freeze step.

**4. Dry-run, and record wall-clock** — this is the number that sizes the public window (item 3 above):

```sh
IS_PRODUCTION=false LEGACY_DATABASE_URL=<copy> yarn migrate:legacy-modmail --source nascar --dry-run
```

**`IS_PRODUCTION=false` is required when running from the VPS host shell**, and is not a mistake: with it `true`, `resolveTargetUrl()` picks `DATABASE_URL_PROD`, whose `postgres` hostname only resolves inside the compose network. Both URLs reach the same physical database on canary — `DATABASE_URL_DEV` just goes via the host-published port. Get that port from `./compose port postgres 5432`, not from `.env.private` (canary doesn't set `LOCAL_DATABASE_PORT` there), and confirm it reaches the right database (`SELECT * FROM modmail_instances`) before trusting it for a `--live` run.

**5. Live, then verify:**

```sh
LEGACY_DATABASE_URL=<copy> yarn migrate:legacy-modmail --source nascar --live
LEGACY_DATABASE_URL=<copy> yarn migrate:legacy-modmail --source nascar --verify
```

Expect their guild in the "needs a forum" list — `mod_forum_id` migrates as `NULL` by design.

**6. Onboard the #216 instance** per [workflow.md](../workflow.md#custom-modmail-instances-216), slug `nascar`. Do this _after_ step 5: preflight warns when a legacy guild already has a `modmail_instances` row, and while that warning is harmless here, it's one you'd want to take seriously during the public run rather than learn to ignore.

**7. Enable DM mode** (`guild_settings.dm_mode = true`) so the user-facing flow matches legacy. The API rejects this unless the instance row exists, so it must follow step 6.

**8. Two manual repairs, neither automatic:**

- **Pick a Forum.** Their admin sets `mod_forum_id` on the dashboard. Until then ModMail does not work for them.
- **Resync snippets.** Migrated `snippets.command_id` values belong to their _legacy_ application and 404 under the new one — press the snippets resync button ([§8](01-architecture.md#8-custom-modmail-instances-216)). Panels resync is not needed; no panels existed on legacy.

**9. Keep their legacy deployment and database warm** for rollback until confidence is established, and **archive the dump offsite** — the same single dump that fed the migration, taken before the test-guild delete and the force-close, so the archive is pristine legacy state and provably identical to what was imported. Checksum it across the transfer and test-restore it once; the VPS surviving is an assumption a rollback plan shouldn't make. The file holds Discord IDs, timestamps and guild config strings — the legacy schema stores no message content — so it is personal data but not a conversation archive.

## Public cutover runbook (#159)

The public run is the pilot at a different scale and on a different application. Everything the pilot established still holds except two things, both consequences of **adopting the legacy application's token** rather than standing up a new identity (decided 2026-08-24, same call Social made in [10-social-port.md](10-social-port.md)'s P6):

- **Snippets do not need a resync.** A snippet is a per-guild slash command owned by whichever application minted it (`services/modmail-bot/src/lib/snippets.ts` resolves `interaction.data.id` against `snippets.command_id`). NASCAR changed application, so every migrated `command_id` 404'd and the resync button was mandatory. Here the application id is unchanged, `/deploy` bulk-overwrites **global** commands only, and guild-scoped snippet commands are untouched by it — so migrated ids keep resolving. That is a claim to smoke-test, not to assume: invoke a migrated snippet in a real guild post-cutover.
- **The guilds already on the new stack are orphaned the other way.** The same rule cuts in the opposite direction for the handful of guilds running v3 ModMail today: their panel messages and snippet commands were minted by the v3-only application `1530137759304515647`, and after the swap the adopted application can neither edit those messages nor see those commands. This is exactly the case `panels/resyncPanels.ts` and `snippets/resyncSnippets.ts` exist for (§8's "a guild swapping which application owns it"), and both are deliberately manual. Capture the affected list in Phase 1 — _before_ the migration, while `snippets` still holds only v3-authored rows — and press both dashboard buttons per guild after `/deploy`. Custom instances (#216) are unaffected; they run on their own tokens.
- **A stale global command set blocks `/deploy` from ever appearing.** `bootstrapGlobalCommands` (`packages/private/bot-core/src/lib/deploy.ts`) seeds `/deploy` **only when the application currently has zero global commands**. The legacy application has a full set (`/reply`, `/close`, `/config`, `/snippets`, …), so booting the new bot against it without wiping them first leaves `/deploy` unregistered and every stale legacy command routing into the new bot's unknown-command resolver. Wipe them between stopping the legacy bot and starting the new one.

### Phase 0 — freeze (2026-08-24T15:00:00Z, done)

Branch `feat/thread-freeze` on legacy `ChatSift/ModMail`: `isThreadFreezeActive()` in `packages/bot/src/util/migrationNotice.ts` gates every path into `openThread` (user DM, `/open`, the Open context menu), so relaying into an already-open thread keeps working exactly as announced. It is a **date check, not a deploy switch** — shipping early is safe, and the presence text flips itself on the hourly refresh. The guard has no upper bound on purpose: it must not lift itself if the cutover slips, or threads opened after the migration would exist only on the legacy side, with no second pass to collect them (`--source` runs once).

### Phase 1 — the 48h window (2026-08-24 → 2026-08-26)

In priority order. Item 1 is the one that can move the date; everything else is preparation.

1. **Dry-run the public database and record the wall clock.** Nothing about the pilot's ~1s transfers to 2,460 guilds. Dump the public legacy database, restore it onto the **v3** Postgres as a scratch database (`modmail_legacy_restore`) rather than alongside on the legacy one — the two stacks sit on separate docker networks, and this is what lets one container reach both sides. Run the script from **inside the running `api` container** (`./compose exec`), which is the only place with `packages/private/db/dist/scripts/` plus prod's `DATABASE_URL_PROD` already in the environment:

   ```sh
   ./compose exec -e LEGACY_DATABASE_URL=<restored copy> api \
     node ./packages/private/db/dist/scripts/migrateLegacyModmail.js --source public --dry-run
   ```

   Preflight will refuse while any legacy thread is open, so force-close **in the copy** first (`UPDATE "Thread" SET "closedAt" = now(), "closedById" = '<id>' WHERE "closedAt" IS NULL`) — itself a faithful rehearsal of the real step. If the run is slow enough to threaten the announced window, that is a finding worth having 48h early rather than 5 minutes in.

2. **Confirm the legacy schema hasn't drifted.** `pg_dump --schema-only` the public database and diff the nine tables against [Old schema](#old-schema-migration-source). Every query in the script uses quoted camelCase legacy column names, so drift is a hard mid-run failure. A tenth table (`_prisma_migrations`) is expected and never read.
3. **Take baseline counts** on the restored copy, per table, and keep them — `--verify` reconciles against them afterwards.
4. **Capture the resync list**, before the migration runs:

   ```sh
   ./compose exec -T postgres psql -U chatsift -d chatsift -At -F$'\t' -c "
     SELECT guild_id,
            count(*) FILTER (WHERE kind = 'panel')   AS panels,
            count(*) FILTER (WHERE kind = 'snippet') AS snippets
     FROM (
       SELECT guild_id, 'panel'   AS kind FROM ticket_panels
       UNION ALL
       SELECT guild_id, 'snippet' AS kind FROM snippets
     ) x
     WHERE guild_id NOT IN (SELECT guild_id FROM modmail_instances)
     GROUP BY guild_id ORDER BY guild_id
   "
   ```

   Every guild it returns needs both resync buttons after the swap — see the second bullet above. After the migration this query stops being useful: `snippets` then also holds 2,460 guilds' worth of legacy rows.

5. **Watch the open-thread count fall.** `SELECT count(*) FROM "Thread" WHERE "closedAt" IS NULL` is the population the force-close will hit mid-conversation on the 26th. The freeze exists to let moderators drain it; a number that isn't falling is a comms problem, not a technical one.
6. **Pre-stage the token swap.** `MODMAIL_BOT_TOKEN` in the host's `.env.private` becomes the legacy application's token. Leave `MODMAIL_SHARDS_PER_REPLICA` unset: `GET /gateway/bot` recommends **2 shards** for this application, and an unset value means one replica claiming a single index that covers both ([12-horizontal-scaling.md](12-horizontal-scaling.md)) — no scaling decision is needed for this cutover.
7. **Know who lands unconfigured.** `mod_forum_id` migrates as `NULL` for **every** guild, so ModMail is inert for all of them until an admin picks a Forum on the dashboard. The script prints the affected guilds; that list is the follow-up comms list, and at this scale it is the largest post-cutover support surface — the owner DMs reached 21 active owners, not 2,460 installs.

### Phase 2 — migration + cutover (2026-08-26T15:00:00Z)

1. **Pre-flight:** freeze confirmed still on; Phase 1's dry-run clean and its duration known; the v3 stack healthy.
2. **Stop the legacy deployment** (`ChatSift/stack`'s `modmail` service). Nothing may write to the legacy database past this point.
3. **Take the final dump, archive it offsite, checksum it across the transfer, and test-restore it once.** Take it _before_ the force-close, so the archive is pristine legacy state and provably identical to what gets imported. It holds Discord ids, timestamps and guild config — the legacy schema stores no message content.
4. **Restore into the scratch database** (drop and recreate `modmail_legacy_restore`), then force-close open threads **in the copy only**. Leaving the live legacy database untouched is what keeps rollback honest.
5. **Migrate and verify**, same invocation as the dry-run with `--live`, then `--verify`. Both scoped to `--source public`, which is what makes them independent of NASCAR's already-migrated rows.
6. **Wipe the legacy application's global commands** — `PUT /applications/981971797480210523/commands` with `[]`. After step 2, before step 7. Skipping this is the one mistake that has no in-place fix: the new bot's bootstrap resolves successfully-but-early, so recovery is wipe-then-restart the container.
7. **Swap the token and start the new bot:** `MODMAIL_BOT_TOKEN` → legacy application, `./compose up -d modmail-bot`.
8. **DM `/deploy`** (admin-gated) to register the new global command set.
9. **Run the resync sweep** over Phase 1's list: dashboard → ModMail → Panels → Resync, then Snippets → Resync, per guild. Panels are reposted under new message ids; snippet commands are recreated under the adopted application and stale ones deleted. Both routes report per-item failures rather than aborting, so re-run any guild that reports one.
10. **Ship the `/invites/modmail` repoint** (`apps/website/next.config.mjs`, prepared): client id → `981971797480210523`, and `permanent: false`, because the 308 it served until now is cached by browsers indefinitely.
11. **Smoke-test** on the test guild (`1530909114736050316`): create a panel, open a ticket through it, reply as staff, close it and confirm the user-side private thread is gone. Then pull a **migrated** legacy thread up in the dashboard thread view and confirm its history renders (message content shows the "not recorded" placeholder by design). Finally, invoke a **migrated snippet** — the one behaviour that is new to the public run.

### Rollback

- **Data:** `DELETE` scoped to `migration_source = 'public'`; the script's own re-run abort prints the exact statement. NASCAR's rows are untouched by it.
- **Bot:** stop `modmail-bot`, put the legacy token back into `ChatSift/stack`'s `modmail` service, restart it — **and re-register legacy's global commands** (its own `packages/bot/src/deploy.ts`), which step 6 deleted. That re-registration is the real cost of the global wipe and the reason rollback is not symmetric with cutover.
- **The freeze stays on** through any rollback unless deliberately reverted: a legacy bot accepting new threads again after a partial migration is worse than one that is merely frozen.
- Keep the legacy deployment and its database warm until confidence is established (#159 stays open until then; decommissioning it is #159's successor work).

## Verification

Everything covered by [01-architecture.md §6a/§7/§8](01-architecture.md#6a-modmail-bot-subsystem-servicesmodmail-bot-m5) was already verified feature-by-feature as each piece shipped (2026-07-16 through 2026-07-30) — see closed issues #152, #261, #216 for the phase-by-phase acceptance checks, not repeated here. What's still unverified is exactly the "Remaining scope" above: the migration dry-run's row-count/content reconciliation, and the live cutover's smoke test.

The `--source` change itself was verified 2026-08-11 against two throwaway legacy-schema databases holding disjoint guilds, migrating into a scratch target: source `a` live + verify clean; source `b` dry-run **not** blocked by `a`'s rows (the old global predicate returned 3 there, i.e. it would have aborted); both sources live, then each verifying independently against its own legacy database with 6 threads in the target; a second `a` live correctly refused, with the printed `DELETE` removing exactly `a`'s 3 threads and leaving `b` intact with no orphaned messages.
