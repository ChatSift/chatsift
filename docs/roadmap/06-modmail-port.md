# M5 — ModMail → ticket-style rebuild + data migration spec

**Milestone target:** TBD — rescope once M4 cutover work is done. This is a materially larger effort than the original "port ModMail as-is" plan it replaces (new create-flow, new dashboard surfaces, a new QOL feature), so the old ~7-week estimate no longer applies. **Depends on:** M1 (foundation pattern), M4 (mirrors the AMA bot's structure and the grant-token/dashboard-config conventions it established). **Live production impact:** yes — this milestone includes a real data migration.

## Status: redesigned 2026-07-22, supersedes the original port plan

The original M5 plan was a straight port of `ChatSift/ModMail`'s DM-based relay model. Owner + collaborator decided (2026-07-22) to rebuild ModMail as a **ticket system** instead: users no longer DM the bot. This doc is the redesign; the "old schema" section below is retained because most of it still applies — **the mod-side experience is explicitly unchanged**, only how a ticket originates changes.

## Goal

Port ModMail from its standalone production repo (`ChatSift/ModMail`) into this monorepo on the new architecture (`defineRoute` contract, postgres.js/Atlas/kanel DB stack), replacing the DM-based create flow with an in-server private-thread ticket flow, and migrate what production data still maps cleanly onto the new shape.

## Why the redesign: DMing the bot is being killed

Direct quote from the design discussion (2026-07-22), owner's framing:

> "I think we should kill DMing the bot, it's pretty terrible lmao. My idea is to have staff teams set up a prompt just like AMA, and as the user you click the button and get a private thread within the server anyway where you type, and on the mod end it looks the exact same. Its totally ok because only server admins can technically peek into that private thread, so it's still very privacy isolated. One 'downside' is it's potentially messier to allow the user to revisit conversations with the mod team — maybe you want to completely nuke their perspective sometime after the thread is closed. I'd imagine more people are more on that end. I guess in a sense this makes it more of a ticket bot than a modmail, but I think this is the superior model anyway."

**Critically: the mod side does not change.** A ticket still lands as a post in the mod-side forum with a running message history, exactly like today's `Thread`/`ThreadMessage` model. Only the user-facing origin changes: an in-server private thread (created by clicking a button) instead of a DM channel. This is why the old schema below is still the migration source, not a from-scratch design — it just gains a few new concepts (categories, panels, an origin distinction) on top.

## New create-flow (design outline from the collaborator, 2026-07-22)

1. A staff-configured embed with a "Create Ticket" button is posted in a channel (a **ticket panel**, new concept — mirrors AMA's prompt-message pattern).
2. User clicks the button → bot opens a **private thread** for them (in a designated parent channel).
3. Bot asks the user to pick a **category** in that private thread.
4. Category selection opens the corresponding **forum thread** for mods (in the designated mod forum channel) and asks the user, in their private thread, what they need help with.
5. Optionally, a category can have a **custom greeting message** posted into the private thread on creation.
6. On close: the user's private thread is **deleted** ("nuked") — they can't revisit it. The mod-forum thread is **not** deleted; it stays as the durable staff-side record, matching today's behavior.
7. Modmail messages still flow to the mod forum exactly as before (relay both directions while the ticket is open).

## QOL: mention/user-ID auto-embed (anti user-ID-swapping)

From the collaborator's design notes:

> "If a message includes a userID/mention in the forum thread, pull up a mini user info embed automatically after the message. This is to combat userID swapping during the report phase. Exclude mentions/userID embeds for mod messages if it resolves to a staff member from a staff member message — so mentioning an admin to flag a modmail won't prompt the embed, but mentioning a normal user will."

Concretely: scan messages posted in a mod-forum ticket thread for a Discord mention or a raw snowflake-shaped token (18–20 digit number). If it resolves to a real guild member, post a compact follow-up embed (avatar, tag, ID, account-created-at, joined-at) — **unless** the resolved user is staff **and** the message author is also staff (mods flagging each other shouldn't trigger noise; mods flagging a _normal_ user still should, even though the author is staff). "Staff" needs a concrete definition during implementation — likely a configurable staff role, or reuse of dashboard-grant/guild-permission data; decide and document here once scoped.

## Old schema (migration source — mostly still applies, see notes)

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

**Migration note (revised 2026-07-22):** because the mod-side model is unchanged, `Thread`/`ThreadMessage`/`Block`/`Snippet`(+`SnippetUpdates`)/`ScheduledThreadClose`/`ThreadOpenAlert`/`ThreadReplyAlert` all still map close to 1:1 onto the new schema — this is **not** the divergent-schema situation AMA was in ([05-migration-cutover.md](05-migration-cutover.md)). The only real gaps: old `Thread.channelId` was always a DM-adjacent staff channel with no notion of "how did this start" or "category" — migrated rows simply get `category_id = null` and `user_thread_id = null` (see new schema below), which is correct: they're historical, closed, and were never going to get the nuke-on-close treatment anyway since there's no private thread to delete.

## New schema (Atlas, `packages/db`)

Reproduce the 9 models above (naming-convention per M1: snake_case + `postgres.camel`, see [01-architecture.md](01-architecture.md)), plus:

- **`GuildSettings`** — drop `greetingMessage` in favor of per-category greetings (see `Category` below); keep a guild-level default used when a category doesn't set its own. Keep `farewellMessage`, `alertRoleId`. Replace `modmailChannelId` with `modForumId` (must be a Forum channel now, since the mod side stays a forum — confirm during implementation whether prod's `modmailChannelId` was already a forum or a plain channel; if plain, this is a behavior note, not just a rename). Add a `staffRoleId` (or similar) for the mention/user-ID QOL feature's staff check, unless dashboard-grant data ends up sufficient.
- **`Category`** (new) — `id`, `guildId`, `name`, `emoji?`, `description?`, `greetingMessage?` (nullable — falls back to guild default), `forumTagId?` (if the mod forum uses one tag per category rather than separate forums — decide during implementation), sort order.
- **`TicketPanel`** (new) — `id`, `guildId`, `channelId`, `messageId`, embed content. Support a raw-JSON authoring mode mirroring AMA's raw-prompt-mode precedent (`AMAPromptData.promptJSONData`), since that pattern is already proven and liked. Multiple panels per guild allowed.
- **`Thread`** — add `categoryId` (nullable — null for pre-migration rows and any guild with no categories configured) and `userThreadId` (nullable — the private thread's channel ID; null for migrated rows and, later, for custom-instance DM-origin tickets, see below). Consider renaming `channelId` to something like `modThreadId` for clarity now that there are two "thread" concepts; if renamed, that's a migration column-rename, not a semantic change.
- **`ThreadMessage`**, **`Block`**, **`Snippet`**/**`SnippetUpdates`**, **`ScheduledThreadClose`**, **`ThreadOpenAlert`**/**`ThreadReplyAlert`** — unchanged in shape from the old schema; `anon`, local per-thread numbering, snippets, scheduled/silent close, and open/reply alerts are all still assumed carried-forward features (none of them were called out as cut in the redesign discussion) — confirm each is still wanted before implementation, since the discussion above focused only on the create-flow and the mention QOL feature.

## Scope

### 1. New schema — see above.

### 2. API (`services/api`, `defineRoute` pattern)

New route group `routes/modmail/`: guild config get/update, category CRUD, ticket-panel CRUD (incl. raw-JSON mode), snippet CRUD, block create/list/delete, thread list/detail (dashboard thread-history view — decide scope during implementation, same as the original plan left open).

### 3. Dashboard (`apps/website`)

New `app/dashboard/[id]/modmail/` area mirroring the AMA dashboard's structure: config screen (mod forum, default greeting/farewell, alert role, staff role), **category management** (name/emoji/description/greeting/forum tag), **ticket panel builder** (embed editor + raw-JSON mode, channel picker, live preview — mirrors `CreateAMAForm`'s normal/raw toggle), snippet management, block management. Thread history view optional, same caveat as original plan.

### 4. Bot (`services/modmail-bot`, new service)

Mirrors `services/ama-bot`'s structure ([01-architecture.md §6](01-architecture.md#6-ama-bot-subsystem-servicesama-bot) — component loader, command loader, resolvers):

- **Ticket panel button** → creates a private thread for the user in the configured parent channel.
- **Category select** (posted in the new private thread) → creates the mod-forum thread (tagged/routed per category), posts the category's greeting (or guild default) back into the user's private thread.
- **Relay, both directions** — private-thread message → mod-forum thread (`ThreadMessage` row, `userMessageId` now means "message ID in the user's private thread" rather than "in a DM"); staff reply in the mod-forum thread → relayed into the user's private thread, anonymous-reply support (`anon` flag) unchanged.
- **Close** — mod-forum thread archived (not deleted, stays as the durable record); user's private thread channel **deleted** after a final closing message, per the "nuke the modmail after for the user" decision. Scheduled/silent close unchanged.
- **Mention/user-ID auto-embed QOL** — see the dedicated section above.
- Local per-thread message numbering (`localThreadMessageId`), snippets (quick-insert, autocomplete), blocks (prevent a blocked user from opening new tickets — replaces "prevent a blocked user's DMs from opening new threads"), open/reply alerts — all carried forward, see the schema notes above on confirming each is still wanted.

## Data migration (real migration — schema is close to identical, see notes above)

1. **Schema mapping:** `Thread`/`ThreadMessage`/`Block`/`Snippet`+`SnippetUpdates`/`ScheduledThreadClose`/`ThreadOpenAlert`/`ThreadReplyAlert` map close to 1:1; `categoryId`/`userThreadId` on migrated `Thread` rows are `null`. Confirm the `modmailChannelId` → `modForumId` mapping (rename vs. behavior change) once the new schema is authored.
2. **Write a migration script** (old Postgres → new Postgres) transforming all 9 old tables, preserving IDs/relations/timestamps exactly (thread history is the whole point of migrating — it must be intact).
3. **Dry-run** against a copy of the production `ChatSift/ModMail` database; reconcile row counts and spot-check message content/ordering per thread.
4. **Cutover runbook** (mirroring [05-migration-cutover.md](05-migration-cutover.md)'s structure, but WITH data migration this time):
   - Announce a maintenance window (ModMail is more synchronous/user-facing than AMA — a message sent during cutover shouldn't get lost).
   - Freeze old ModMail (stop accepting new DMs/replies — the old bot is still DM-based right up to cutover) for the migration run.
   - Run the migration script against a final snapshot.
   - Deploy the new bot, point the token, smoke-test (create a ticket via a panel, reply from staff, close a ticket and confirm the private thread is gone).
   - Keep old deployment + database warm for rollback until confidence is established.

## Future, explicitly not this milestone: single-guild custom-instance mode

From the design discussion (2026-07-22), kept here so M5's implementation doesn't foreclose it:

> There's a vision of offering custom branded instances of the bot to specific paying customers — a special env flag for single-guild mode (binding the bot to that guild ID), a special section in that guild's dashboard settings to manage their custom instance, and **DMs return** (bypassing the private-thread ticket flow entirely, matching current prod behavior) depending on an env var on the deployment. These would be priced deployments hardcoded into the main repo's docker-compose per customer, sharing the shared Postgres/Redis/API backend — so a main-stack outage takes the custom instance down too, cosmetically separate only. "Probably the last thing to implement, but worth keeping in mind in how we design the bot from the get-go."

**Design constraint this puts on M5:** don't hardcode "a ticket always starts via a private thread" deep into the relay/close/snippet/block/alert logic. The ticket-creation entrypoint (panel button + private thread, vs. a future DM) should be a swappable front door feeding the same `Thread`/`ThreadMessage` model — which the schema above already supports, since `userThreadId` is nullable and the mod-forum side doesn't care how a thread originated. No further action needed for M5 beyond keeping that boundary clean; don't build the env flag, the dashboard section, or DM support itself this milestone.

## Verification

Schema authored and migrated cleanly via Atlas; full ticket lifecycle exercised on the new bot: click a panel → private thread created → pick a category → mod-forum thread created with the right tag/routing → category greeting posted → relay a message each direction → an anonymous reply → a snippet use → a scheduled silent close → close a ticket and confirm the private thread is deleted while the mod-forum thread survives → a blocked user's ticket-panel click rejected → the mention/user-ID auto-embed fires for a normal-user mention and is suppressed for a staff-mentioning-staff message. Migration dry-run reconciled against the old database (row counts + spot-checked thread content) before any live cutover.
