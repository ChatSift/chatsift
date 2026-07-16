# M5 — ModMail port + data migration spec

**Milestone target:** ~2027-01-mid (~7 weeks from M4, includes a holiday buffer). **Depends on:** M1 (foundation pattern), M3/M4 conventions (mirrors the AMA bot's structure). **Live production impact:** yes — this milestone includes a real data migration, unlike AMA's drain-and-swap ([05-migration-cutover.md](05-migration-cutover.md)).

## Goal

Port ModMail from its standalone production repo (`ChatSift/ModMail`) into this monorepo on the new architecture (defineRoute contract, postgres.js/Atlas/kanel DB stack), and migrate its production data — this data (threads, message history, snippets, blocks) is worth preserving, unlike AMA's ephemeral event data.

## Old schema (migration source)

From `ChatSift/ModMail`'s `prisma/schema.prisma` (captured 2026-07-16):

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

**This is a genuinely richer domain than AMA** — snippets with edit history, scheduled/silent closes, per-user blocks with expiry, open/reply alert subscriptions, anonymous staff replies, and a per-guild local message numbering scheme. Size the milestone accordingly; this is a full product port, not a stub.

## Scope

### 1. New schema (Atlas, in `packages/db`)

Reproduce all 9 models above in the new schema alongside the AMA/core tables from M1. Preserve field semantics exactly (e.g. `anon` on `ThreadMessage`, the `[threadId, localThreadMessageId]` uniqueness, `Block.expiresAt` nullability for permanent blocks). Naming-convention decision from M1 (camelCase-quoted vs. snake_case+transform) applies here too — stay consistent with whatever M1 chose.

### 2. API (`services/api`, `defineRoute` pattern from [02-foundation.md](02-foundation.md))

New route group `routes/modmail/` — at minimum: guild config get/update (`GuildSettings`), snippet CRUD, block create/list/delete, thread list/detail (for a dashboard view of thread history, if wanted this stage — decide and note the decision here once scoped).

### 3. Dashboard (`apps/website`)

New `app/dashboard/[id]/modmail/` area mirroring the AMA dashboard's structure ([03-dashboard-config.md](03-dashboard-config.md)): config screen (modmail channel, greeting/farewell messages, simple mode, alert role), snippet management, block management. Thread history view is optional for this stage — scope during implementation.

### 4. Bot (`services/modmail-bot`, new service)

Mirrors `services/ama-bot`'s structure ([04-ama-complete.md](04-ama-complete.md)'s Cluster 1/2 patterns apply here too — component loader, command loader, resolvers):
- Gateway bot receiving DMs → opens/reuses a staff-side thread (channel or thread-per-user, matching the old `channelId`-per-`Thread` model).
- Staff replies in the thread → relayed back to the user's DM, with anonymous-reply support (`anon` flag).
- Local per-thread message numbering (`localThreadMessageId`) for staff-friendly references.
- Snippets — quick-insert canned responses, usable as slash-command autocomplete (`Snippet.commandId` suggests the old bot registered snippets as commands — decide whether to keep that pattern or move to a `/snippet use <name>` command).
- Scheduled thread close (silent or not) — a delayed-close mechanism, needs a scheduler (cron-like job or delayed queue, consistent with how this monorepo handles background work elsewhere).
- Blocks — prevent a blocked user's DMs from opening new threads, respecting `expiresAt`.
- Open/reply alerts — notify subscribed staff (`ThreadOpenAlert`/`ThreadReplyAlert`) on new threads/replies.

## Data migration (real migration, unlike AMA)

1. **Schema mapping:** the old and new schemas are expected to be close-to-identical in shape (unlike AMA, where the schemas diverged significantly) — confirm this once the new schema is authored, and document any renames/splits here.
2. **Write a migration script** (old Postgres → new Postgres) transforming all 9 tables, preserving IDs/relations/timestamps exactly (thread history is the whole point of migrating — it must be intact).
3. **Dry-run** against a copy of the production `ChatSift/ModMail` database; reconcile row counts and spot-check message content/ordering per thread.
4. **Cutover runbook** (mirroring [05-migration-cutover.md](05-migration-cutover.md)'s structure, but WITH data migration this time):
   - Announce a maintenance window (ModMail is more synchronous/user-facing than AMA — a DM sent during cutover shouldn't get lost).
   - Freeze old ModMail (stop accepting new DMs/replies) for the migration run.
   - Run the migration script against a final snapshot.
   - Deploy the new bot, point the token, smoke-test (send a test DM, reply from staff, close a thread).
   - Keep old deployment + database warm for rollback until confidence is established.

## Verification

Schema authored and migrated cleanly via Atlas; full DM→thread→reply→close cycle exercised on the new bot including an anonymous reply, a snippet use, a scheduled silent close, and a blocked user's DM being rejected. Migration dry-run reconciled against the old database (row counts + spot-checked thread content) before any live cutover.
