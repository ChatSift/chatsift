# M5 — ModMail: legacy data migration + cutover

**Milestone target:** TBD — no date has been publicly announced for ModMail yet (unlike M4's, see [05-migration-cutover.md](05-migration-cutover.md)). **Depends on:** nothing blocking — the M1 foundation pattern and the M4-established bot/grant-token conventions this milestone originally depended on have both already shipped and been reused (see below). **Live production impact:** yes, and unlike M4 this one includes a real historical-data migration.

## Status: feature work shipped 2026-07-30; only the legacy migration + cutover remain

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

1. ~~**Write a migration script**~~ — done (#157): `packages/private/db/src/scripts/migrateLegacyModmail.ts`, run via `yarn migrate:legacy-modmail --dry-run|--live|--verify` with `LEGACY_DATABASE_URL` pointing at a restored copy of the legacy database. Transforms all 9 legacy tables per the mapping above, preserving relations and timestamps exactly. **Integer PKs are regenerated, not preserved** — the new database already holds partner-instance rows, so legacy ids would collide; ids come off each table's identity sequence via `nextval`, which also means no `setval()` fixup afterwards. Three things worth knowing before running it:
   - It **refuses to run while any legacy thread is still open**. Force-closing them is a deliberate runbook step (item 3 below), not something the script does silently.
   - It **refuses to run twice**. Thread history is not idempotent — `threads` has no unique key to conflict on, so a second pass would duplicate every ticket. Starting over means deleting the migrated rows by hand first; the abort message carries the exact statement.
   - `mod_forum_id` is migrated as `NULL` for every guild, deliberately: the legacy value was a text channel and the new mod side needs a Forum. The script prints the list of affected guilds so it can drive follow-up comms.
2. **Dry-run** against a copy of the production legacy `ChatSift/ModMail` database; reconcile row counts and spot-check message content/ordering per thread. `--dry-run` runs the whole migration in a transaction and rolls it back (so every FK/CHECK/unique constraint is genuinely exercised), and `--verify` is the read-only reconciler: per-table row counts, per-thread message counts, and full message-set comparison on a random sample.
3. **Cutover runbook** (mirroring [05-migration-cutover.md](05-migration-cutover.md)'s structure, but _with_ a data migration this time):
   - Announce a maintenance window — ModMail is more synchronous/user-facing than AMA was, a message sent mid-cutover shouldn't get lost.
   - Freeze the legacy bot (stop accepting new DMs/replies — it's still DM-based right up to cutover) for the migration run.
   - Run the migration script against a final snapshot, then `--verify`. **Record the wall-clock duration of the dry-run (item 2) and budget the maintenance window off that** — it's the only honest estimate available, since runtime is dominated by legacy row counts nobody has measured yet. The script sets `statement_timeout`/`idle_in_transaction_session_timeout` to 0 for its own transaction (it holds one transaction open across reads of the _legacy_ database, so it idles for reasons unrelated to Postgres' own speed), but that only covers server-side limits — a connection killed by something in between, or the operator's own shell timing out, still means restarting the whole run.
   - Deploy `services/modmail-bot` as the public deployment, point the token, smoke-test (create a ticket via a panel, reply from staff, close a ticket and confirm the private thread is gone, pull up a migrated legacy thread in the dashboard thread view and confirm its history rendered correctly).
   - Keep the legacy deployment + database warm for rollback until confidence is established.

## Verification

Everything covered by [01-architecture.md §6a/§7/§8](01-architecture.md#6a-modmail-bot-subsystem-servicesmodmail-bot-m5) was already verified feature-by-feature as each piece shipped (2026-07-16 through 2026-07-30) — see closed issues #152, #261, #216 for the phase-by-phase acceptance checks, not repeated here. What's still unverified is exactly the "Remaining scope" above: the migration dry-run's row-count/content reconciliation, and the live cutover's smoke test.
