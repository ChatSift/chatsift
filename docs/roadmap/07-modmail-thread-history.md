# Dashboard view of past ModMail threads (#261)

**Depends on:** M5's ModMail schema/API/bot ([06-modmail-port.md](06-modmail-port.md)) — this doc assumes
that milestone's `threads`/`thread_messages`/category/forum-tag model already exists as described there.
Not itself a numbered milestone (M0–M5); tracked as its own GitHub issue (#261) since the original M5 doc
explicitly left it optional/unscoped ("Thread history view optional, same caveat as original plan").

## Status: Phase 1 done 2026-07-27, Phase 2 done 2026-07-28 (scope grew beyond what's written below — see

"Phase 2 additions" at the end of that section), Phase 3 not started

## Goal

A dashboard view where staff can browse past and open ModMail tickets, see a user's full ticket history,
view thread metadata (roles, thread count, category, forum tags), and read the full message history with
reply-chains collapsed by default. Full issue text:

> - navigate through threads - closed/open
> - when a thread is selected, the page allows you to easily navigate to other threads the user has made in
>   the past
> - the UI shows relevant details (user's roles, thread count, the category, the internal forum tags applied
>   to the thread)
> - convos around replies are collapsed by default and can be expanded/collapsed back at any time
>
> A big consideration here is storage mechanism. Threads can grow to thousands of messages, so fetching all
> of them on-demand is unreliable. We will need to store every single message sent in them... Considering
> the privacy implications, this does mean that recording should be disabled by default and something you
> opt into, consenting that all replies sent through the bot & all surrounding messages in the mod thread
> are recorded.
>
> We also need to look carefully into how we replicate Discord UI.

## Current-state facts that shape this plan

Verified against the live repo (2026-07-27), not assumed from the M5 doc:

- `thread_messages` stores **zero content** — only Discord message IDs (`userMessageId`, `guildMessageId`),
  `userId`/`staffId`, and `anon`. `services/modmail-bot`'s `lib/relay.ts` composes full content into a live
  Discord embed and posts it, but never writes it back to Postgres.
- The mod-forum thread (`threads.modThreadId`) is deliberately **never deleted** on close, only
  archived+locked — durable staff record by design (`lib/threadClose.ts`). Only the user's private thread
  (`userThreadId`) gets nuked after `nukeDelayMinutes`.
- `services/api`'s `listThreads`/`getThread` routes already exist and are mounted
  (`services/api/src/routes/modmail/threads/{listThreads,getThread}.ts`), but the frontend has **zero UI or
  hooks consuming them** — `queryKeys.modmail.threads.*` is pre-scaffolded but unused. Neither route
  paginates — this repo has **no pagination pattern anywhere** yet.
- The ModMail dashboard area already exists (`apps/website/src/app/dashboard/[id]/modmail/`) with a
  consistent list/`new`/`[id]`-edit pattern across categories/panels/snippets/blocks/config, directly
  reusable for a new `threads/` section.
- No Discord-message-rendering component exists anywhere in the repo (no markdown/mention/embed parser, no
  relevant library in `package.json`) — this is genuinely new work.

## Decisions

- **Deleted messages**: the recorded copy survives even if the live Discord message is deleted — consistent
  with the "mod-forum thread is the durable record" principle M5 already established.
- **Attachments**: store the Discord CDN URL as captured at record-time, as-is. No re-hosting to owned
  storage. Discord's attachment CDN URLs are signed with an expiry (`ex` query param), so "as-is" doesn't
  mean "permanently stale": since the mod-forum message these were re-uploaded onto is never deleted (see
  above), an expired URL is healed lazily, on read, by `getThread.ts` re-fetching that same message
  (`thread_messages.guildMessageId` + `threads.modThreadId`, no schema change needed) and re-matching its
  current attachments back onto the recorded ones by filename. This only fires when a recorded URL's `ex`
  timestamp has actually passed (not speculatively on every read), and the refreshed URL is **not**
  persisted back to `thread_message_content` — it'll just re-expire eventually, and keeping a GET route
  side-effect-free was judged simpler than a self-healing write-back cache. If the source message itself
  is gone (the durable record deleted out of band — not expected, but not ruled out), the affected
  attachment(s) are flagged unavailable in the API response instead of failing the request; the frontend
  is expected to render that as "attachment no longer exists on Discord" rather than attempting to load a
  dead URL. See `services/api/src/routes/modmail/threads/util.ts`'s `resolveMessageAttachments`.
- **Internal mod-thread chatter** (added during Phase 2, not originally scoped in either phase below): the
  issue text's "all surrounding messages in the mod thread are recorded" was narrowed away during Phase 1
  to just the user-relay and `/reply`/`/reply-q` log copies — plain mod-to-mod discussion posted directly
  in the mod-forum thread was never captured at all. Revisited and added: `thread_messages` gained
  `is_internal BOOLEAN NOT NULL DEFAULT false` and `user_message_id` was loosened to nullable (`NULL` for
  an internal row — nothing was ever relayed to the user's thread for it to point at). Captured the same
  way user messages are (a raw `MessageCreate` listener, this time matched against a thread's `modThreadId`
  instead of `userThreadId`), gated on the same recording consent toggle, and only worth inserting a row
  for at all when that's on (unlike a real relayed exchange, an unrecorded internal row would carry zero
  information). Deliberately **asymmetric** with the "deleted messages survive" decision above: a mod
  deleting their own internal note is a true delete (row removed), not a soft "keep but don't show" —
  internal chatter isn't part of the user-facing exchange the "mod-forum thread is the durable record"
  principle is protecting, so there's nothing being lost that the ticket record depends on. See "Phase 2
  additions" below and Phase 3's edit/delete-capture items.

## Phase 1 — DB + API (+ coupled bot writer)

A consent toggle and a content schema with nothing populating it is inert, so Phase 1 includes the
`services/modmail-bot` writer changes even though it's titled "DB + API" — this is the coupled dependency
that makes the whole feature non-inert.

### Schema (`packages/private/db/schema/schema.sql`)

Add to `guild_settings`: `record_thread_content BOOLEAN NOT NULL DEFAULT false`,
`record_thread_content_enabled_by TEXT`, `record_thread_content_enabled_at TIMESTAMPTZ` (audit trail for
who opted in and when; not reset back to null on later disable).

New sidecar table, 1:1 with `thread_messages` — same PK-is-FK shape as the existing
`scheduled_thread_closes`/`scheduled_thread_nukes` precedent, keeping the load-bearing `thread_messages`
table lean and giving recorded content its own lifecycle:

```sql
CREATE TABLE thread_message_content (
  thread_message_id            INTEGER PRIMARY KEY REFERENCES thread_messages (id) ON DELETE CASCADE,
  content                      TEXT NOT NULL DEFAULT '',
  replied_to_thread_message_id INTEGER REFERENCES thread_messages (id) ON DELETE SET NULL,
  is_forwarded                 BOOLEAN NOT NULL DEFAULT false,
  attachments                  JSONB NOT NULL DEFAULT '[]', -- [{ url, filename, contentType, size }]
  stickers                     JSONB NOT NULL DEFAULT '[]', -- [{ id, name, formatType }]
  recorded_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX thread_message_content_replied_to_idx ON thread_message_content (replied_to_thread_message_id)
  WHERE replied_to_thread_message_id IS NOT NULL;
```

A `NULL`/absent row for a given `thread_message_id` is how "this message predates recording being enabled"
falls out naturally — no backfill, no retroactive marker needed; the frontend renders it as a "not
recorded" placeholder. Workflow: edit `schema.sql` → `yarn db:diff` (Atlas generates the migration) →
`yarn db:migrate` → `yarn db:gen` (kanel regenerates
`packages/private/db/src/generated/public/{GuildSettings,ThreadMessageContent}.ts`).

### Bot writer (`services/modmail-bot/src/lib`)

- `lib/threads.ts`: widen `findRepliedToGuildMessageId` (or add a sibling) to also return the target row's
  `id`, not just `guildMessageId` — it already runs the exact lookup needed. Extend `insertThreadMessage`'s
  options with an optional `content` payload (`text`, `repliedToThreadMessageId`, `isForwarded`,
  `attachments`, `stickers`); when present, wrap the existing `INSERT INTO thread_messages` and a new
  `INSERT INTO thread_message_content` in one `db.begin(...)` transaction. Add `isRecordingEnabled(guildId)`
  — a plain `SELECT record_thread_content FROM guild_settings WHERE guild_id = ?`.
- `lib/relay.ts`: in both `relayUserMessageToModThread` and `relayStaffReplyToUserThread`, when recording is
  enabled, build the content payload from data already in scope at the `insertThreadMessage` call site
  (`content`/`resolvedContent`, `media` attachments/stickers, the resolved reply-target id). Attachment URLs
  come off the **posted message's own REST response** (the re-uploaded CDN URLs), not the original (possibly
  ephemeral) source URL.
- `lib/userMessageLifecycle.ts`: on a user message edit, if a `thread_message_content` row exists,
  `UPDATE ... SET content = ?` in place. No edit-history/versioning table in this phase (explicitly deferred
  — would mirror `snippet_updates`' pattern if ever needed). On delete: **no mutation of the recorded row**
  — it survives per the confirmed decision above.

**Bug found and fixed during Phase 2** (not a Phase 1 scope change, just noting where): `insertThreadMessage`
originally wrote `attachments`/`stickers` as `${JSON.stringify(x)}::jsonb`. Binding an already-stringified
value as an untyped parameter with a `::jsonb` cast makes postgres.js/Postgres double-encode it — the
column ends up holding a JSON _string_ containing escaped JSON instead of a real array, which surfaced as a
500 (`attachments.some is not a function`) the first time a recorded message with attachments was read back.
Fixed by binding through `sql.json(...)` instead, which carries the correct type through in one pass.

### API (`services/api/src`)

New shared pagination primitive in `services/api/src/util/schemas.ts` (this is the first paginated route in
the codebase — worth a short comment noting that):

```ts
export function createPaginationQuerySchema(defaultLimit: number, maxLimit: number) {
	return z.object({
		cursor: z.coerce.number().int().positive().optional(),
		limit: z.coerce.number().int().positive().max(maxLimit).optional().default(defaultLimit),
	});
}
```

**Recording toggle** — extend `updateConfigBodySchema` (`services/api/src/routes/modmail/schemas.ts`) with
`recordThreadContent: z.boolean().optional()`. `getConfig.ts`/`updateConfig.ts` pick up the new
`guild_settings` columns; `updateConfig.ts` additionally sets `record_thread_content_enabled_by`/`_at`
(from `req.tokens.access.sub`) only on the false→true transition, in the same upsert.

**`listThreads.ts`** — extend `querySchema` with `include_closed` (unchanged) +
`createPaginationQuerySchema(25, 100)`. Query becomes cursor-scoped (`AND id < cursor ... LIMIT limit`),
`LEFT JOIN categories` for a `{ id, name, emoji }` badge, and resolve each row's `userId` to an `APIUser`
via `discordAPIModmail.users.get` (404 → bare snowflake) — same pattern `blocks/listBlocks.ts` already
uses. Response: `{ threads: [...], nextCursor: number | null }`.

**`getThread.ts`** — extend with a message-pagination query (`cursor`, `limit`,
`direction: 'before' | 'after'`) over `local_thread_message_id`. `LEFT JOIN thread_message_content` — null
columns for pre-recording messages, populated for recorded ones. New enrichment, computed once per request:
`category` (join), `member` (`discordAPIModmail.guilds.getMember`, 404→null; role _names_ resolved
client-side against `useGuildInfo`), `appliedTagIds` (`discordAPIModmail.channels.get(modThreadId)` →
`applied_tags`, works for archived threads since the channel is never deleted), `userThreadCount` (same
`COUNT(*)` query `lib/threads.ts`'s `countPastThreadsForUser` already runs bot-side — duplicate rather than
share across the service boundary), `otherThreads` (sibling threads for the same user, for "navigate to
this user's other threads"), `participants` (dedup'd `{userId/staffId → APIUser}` map scoped to the
current message page, keeping per-message rows lean), and — per-message, only for recorded rows —
`recordedContent.attachments` resolved through `resolveMessageAttachments` (lazy expired-URL refresh, see
the **Attachments** decision above). Shared enrichment helpers go in a new
`services/api/src/routes/modmail/threads/util.ts` rather than being duplicated across the two route files.

No new route files/mounts needed — both routes are extended in place; `InferRouteContract` carries the
richer response type through automatically.

## Phase 2 — Frontend config + scaffold (minimal message rendering)

Everything except full Discord-style rendering. Mirrors the repo's existing list/`new`/`[id]` dashboard
conventions throughout.

- **Recording toggle** — extend
  `apps/website/src/app/dashboard/[id]/modmail/config/_components/ModmailConfigForm.tsx` exactly like the
  existing `nukeEnabled` field: add `recordThreadContent` to `ConfigFormData`/`CONFIG_FIELDS`, seed from the
  config query, render as a clearly-marked consent checkbox (warning styling, not a plain field) with copy
  mirroring the issue's own consent language. Show the `enabledBy`/`enabledAt` audit line once on. No
  frontend type-plumbing needed beyond this — response types are derived from `InferRouteContract`.
- **New data hooks** — new file `apps/website/src/api/routes/modmailThreads.ts` (split out from the
  already-large `modmail.ts`), first `useInfiniteQuery` usage in the repo: `useModmailThreads(guildId,
includeClosed)` and `useModmailThread(guildId, threadId)`, both paging via the `nextCursor` the Phase 1
  routes return. Reuses the pre-scaffolded `queryKeys.modmail.threads.*`.
- **List page** — `modmail/threads/page.tsx` (RSC shell: `DashboardCrumbs` + `Heading`) →
  `_components/ThreadsList.tsx` (client). Unlike every existing `*List.tsx`, the open/closed filter can't be
  a client-side `useMemo` anymore (no full collection to filter) — it's a state var feeding the query key
  directly. Row per thread: resolved user, category badge, open/closed pill, "Load more" button.
- **Detail page** — `modmail/threads/[threadId]/page.tsx` → `_components/ThreadDetail.tsx` (two-pane):
  `ThreadSidebar.tsx` (roles resolved against `useGuildInfo`, `userThreadCount`, `otherThreads` links,
  category, applied tags resolved against `useModForumTags`) and `ThreadMessageList.tsx` (plain
  `whitespace-pre-wrap` rows, "Load more", a muted "not recorded" placeholder for null-content rows, no
  virtualization yet — that's a Phase 3 concern once rendering gets heavier). `ThreadMessage.tsx`: author
  label, timestamp, plain content, and a `useState` expand/collapse toggle for `repliedToThreadMessageId`
  (looked up client-side in the already-loaded page) — this satisfies "collapsed by default" structurally
  without Discord-accurate styling yet.
- **Navigation wiring**: add a "Threads" card to `modmail/page.tsx`'s `SECTIONS` array; in
  `apps/website/src/components/dashboard/DashboardCrumbs.tsx`, add `'threads'` to `MODMAIL_SECTIONS` and a
  `SEGMENT_DEFINITIONS` entry for `['modmail', 'threads', ':id']` (label falls back to `Thread #${id}` —
  threads have no name field; "Ticket" terminology from the rest of ModMail's UI was deliberately not used
  for this feature's own pages, see "Phase 2 additions" below).

Basic cursor "Load more" pagination is sufficient for this phase — no virtualization library yet.

### Phase 2 additions (beyond what was scoped above)

Landed in the same PR as the plan above, discovered/requested once the scaffold was actually being used:

- **Terminology**: this feature's own UI (breadcrumb, page titles, sidebar, empty states, the recording
  consent copy) says "Thread" throughout — "Thread #N" rather than "Ticket #N" — not "Ticket". The rest of
  ModMail's dashboard (categories/panels/snippets/blocks) still says "ticket" and was deliberately left
  alone; this rename was scoped to only the new pages.
- **Search bar** — not in the original plan at all. `apps/website/src/app/dashboard/[id]/modmail/threads/
page.tsx` now uses the same `SearchBar`/`useURLParam` pattern as the AMA sessions list. Backend side:
  `listThreads.ts`'s new `q` param — an exact snowflake filters `threads.user_id` directly; free text
  resolves against Discord's own guild-member-search endpoint (prefix match on username/nickname) since no
  username is ever stored, then filters `user_id = ANY(...)`. This means a name search only finds ticket
  authors still in the guild; an id search always works.
- **Sticker rendering** — pulled forward from Phase 3's `DiscordAttachments.tsx` scope: `ThreadMessage.tsx`
  renders `recordedContent.stickers` as real images (static formats off Discord's CDN, `GIF` off the media
  proxy host); `Lottie` stickers have no static image and fall back to a name chip. Everything else in
  Phase 3's rendering list (markdown, mentions, embeds, attachment image grid/lightbox) is still untouched.
- **Internal mod-thread chatter** — see the new Decisions entry above for the schema/capture side. On the
  frontend, an internal message renders in a visually distinct dashed, amber-tinted box with a lock icon
  and an explicit "not seen by the user" label — deliberately more than a small badge, so it can't be
  mistaken for part of the actual user conversation at a glance.

## Phase 3 — Complete Discord-like view

**Not a rewrite.** Per owner feedback once Phase 2 landed: the current minimal rendering is good enough
that Phase 3 does _not_ need to chase pixel-accurate Discord reproduction or a heavy refactor of what's
there — the items below are the actual gaps to close, not a mandate to redo the UI. Ordered roughly by how
much they were flagged as musts vs. nice-to-haves.

### Musts (owner-flagged gaps, 2026-07-28)

- **Mod-side message grouping & collapse**: mostly already covered by the `MessageAuthorHeader.tsx`
  bullet below (avatar/name suppressed on consecutive messages from the same author, Discord-style) —
  confirmed still the right shape for this. New wrinkle since Phase 2: internal mod-thread chatter (see
  Decisions above) should additionally be collapsible _as a block_ — a back-and-forth of internal notes
  between two relayed/`/reply` messages shouldn't force scrolling through all of it by default the way nothing
  in Phase 2 currently prevents.
- **Mod-side plain message edit/delete isn't captured**: `lib/userMessageLifecycle.ts`'s `MessageUpdate`/
  `MessageDelete` listeners only watch a ticket's _private_ thread (the user's side). A plain message posted
  directly in the mod-forum thread (an `is_internal` row) that a mod then edits or deletes via Discord's own
  UI updates neither the live message (expected, Discord already did that) nor our recorded copy — the
  dashboard silently shows stale content. Needs the same shape of listener, scoped to `guild_message_id` +
  `is_internal = true` instead of `user_message_id` (mirrors `findUserThreadMessageByMessageId`, just on the
  mod-thread side rather than the user-thread side). **Delete must be a true delete** — `DELETE FROM
thread_messages WHERE ...` (cascades to `thread_message_content` and to anything replying to it, per the
  existing `ON DELETE CASCADE`/`ON DELETE SET NULL` FKs), not the soft "survives" treatment user-side
  deletes get. This is a deliberate asymmetry (see the Decisions entry above): the durable-record principle
  protects the user-facing exchange, not a mod's own retracted internal note.
- **Edit badge + history for user-side messages**: content is currently overwritten in place
  (`userMessageLifecycle.ts`) with no trace that an edit happened — this resolves what used to be Open
  Question #2 below, now confirmed needed. Requires a new sidecar table mirroring `snippet_updates`' pattern
  (e.g. `thread_message_content_edits`, one row per prior version, FK to `thread_message_content`) written
  on each edit instead of the current blind overwrite. Frontend: a small clickable "edited" badge on the
  message that opens a tooltip/popover listing prior versions (newest first) when more than one edit has
  happened.
- **Delete badge for user-side messages**: the Decisions section's "recorded copy survives" only means the
  _content_ isn't touched — there's currently no marker anywhere that the live message was ever deleted, so
  the dashboard can't tell a still-live message from a deleted one. Needs a `deleted_at TIMESTAMPTZ` (or
  similar) column, set by `userMessageLifecycle.ts`'s delete handler instead of the current no-op, purely
  for display — the row and its content keep existing exactly as they do today. Frontend: a "deleted" badge
  alongside (not instead of) the message content.
- **Jump to top/bottom UI**: an explicit affordance to jump to the start or the latest end of a thread's
  messages, not just "Load more" at the bottom. Ties into the virtualization item below — once
  `direction: before/after` is exercised properly, jump-to-latest and jump-to-oldest both become "load a
  page at that end and scroll to it" rather than paging through everything in between.

### Everything else originally scoped for this phase

- **Rendering**: start with a short research spike (don't assume a library exists — verify) into whether
  something like `discord-markdown` or a Discord-styled component library actually fits the bot's
  constrained message shape (plain markdown, at most one embed, files, no reactions/polls/components).
  Stickers (images) and basic attachment links already render as of Phase 2 — remaining gap is markdown/
  mentions/emoji/channel-refs and the embed itself. If nothing fits cleanly, hand-roll a small set of
  components: `DiscordMarkdown.tsx` (mentions/emoji/channel-refs/formatting), `DiscordEmbed.tsx`,
  `DiscordAttachments.tsx` (image grid/lightbox, file chips — stickers already have a minimal version of
  this), `MessageAuthorHeader.tsx` (avatar, consecutive-message grouping), `ReplyPreview.tsx`
  (Discord-accurate collapsed reply bar with click-to-jump). Extend the existing Discord-dark-theme token
  approach already in `panels/_components/PanelPreview.tsx` rather than reinventing colors. Per the owner
  note above, this is about closing real gaps (markdown/mentions/embeds), not chasing 1:1 fidelity for its
  own sake.
- **Virtualization**: introduce `@tanstack/react-virtual` in `ThreadMessageList.tsx` once rendering is heavy
  enough per-message to matter at "thousands of messages" scale. This is also where the API's
  `direction: before/after` pagination (designed in Phase 1, used one-directionally in Phase 2) gets
  exercised properly — initial load jumps to the latest messages, older pages load on scroll-up. Also what
  the jump-to-top/bottom must above builds on.
- **Full collapse/expand UX**: replace Phase 2's plain toggle with Discord's actual reply-grouping visual —
  expand shows the referenced message inline, not just a jump-link.

## Verification

- **Phase 1**: `turbo run build lint test` green; migration applies cleanly (`yarn db:migrate`) and kanel
  regenerates without manual fixup; run `services/modmail-bot` + `services/api` locally, flip the
  (not-yet-UI-exposed, use a direct API call or temporary curl) recording toggle on for a test guild,
  exchange a few messages including a native Discord reply and an attachment, confirm
  `thread_message_content` rows appear with correct `repliedToThreadMessageId`/attachments; call
  `getThread`/`listThreads` directly and confirm pagination (`cursor`/`nextCursor`), enrichment (`member`,
  `appliedTagIds`, `userThreadCount`, `otherThreads`, `participants`) all resolve correctly for both an open
  and a closed/archived thread.
- **Phase 2**: run `apps/website` locally against the Phase 1 API; toggle recording on via the new settings
  checkbox; navigate list → detail, confirm open/closed filtering re-fetches correctly, sidebar metadata
  renders (roles, thread count, category, tags), "Load more" works on both threads and messages, reply
  collapse/expand toggles correctly, a pre-recording message shows the "not recorded" placeholder. Also
  covering the Phase 2 additions: search by both a raw id and a still-in-guild member's name returns the
  expected threads; a message containing a sticker renders it (static image, or the animated `GIF` variant);
  a plain message posted directly in the mod-forum thread shows up in the thread view styled distinctly
  (dashed amber box) from the real user-facing exchange, and does _not_ appear anywhere in the user's own
  private thread.
- **Phase 3**: exercise a thread containing markdown, mentions, custom emoji, an embed, image and non-image
  attachments, and a native reply — confirm rendering matches what the bot actually posted to Discord;
  confirm virtualization keeps a very long thread's DOM bounded (spot-check via browser devtools node
  count) and scroll-up correctly loads older pages via `direction: before`. Plus the musts: editing/deleting
  a plain mod-thread message updates/removes the recorded copy (and delete is a real `DELETE`, confirm the
  row is actually gone, not just hidden); an edited user message shows the edit badge, clicking it lists
  every prior version in order; a deleted user message shows the delete badge while its content is still
  fully readable; jump-to-top and jump-to-bottom both land at the right end of a long thread without paging
  through everything in between.

## Open questions (not blocking, revisit if they come up during implementation)

1. Consent UX: is a single checkbox sufficient, or does the compliance weight of "recording all ticket
   conversations" warrant a stronger confirmation (modal, typed-confirmation input)?
2. ~~Edit history~~ — resolved 2026-07-28: confirmed needed, now a Phase 3 must (see above).
3. Retention/purge: no retention window or right-to-erasure sweep is in scope here — "recorded forever once
   opted in" is accepted for now; a `nukeDelayMinutes`-style retention window for recorded content could be
   a follow-up issue.
4. Roles/forum tags are live-fetched at request time (current state), not a point-in-time snapshot from
   when the ticket was active — confirm this stays desired as the feature gets used.
5. Pagination defaults (25 threads/page, 50 messages/page) are reasonable starting points but arbitrary —
   worth sanity-checking against real thread sizes before locking them into the public API contract.
6. Internal-chatter true-delete (Phase 3 must, above) means a mod's own DB row can vanish entirely, unlike
   everything else this feature records — worth a beat of thought on whether that ever needs its own audit
   trail (e.g. "an internal note existed and was deleted, by whom, when") before implementing, or whether
   "true delete, no trace" is genuinely the intent.
