# Dashboard view of past ModMail threads (#261)

**Depends on:** M5's ModMail schema/API/bot ([06-modmail-port.md](06-modmail-port.md)) — this doc assumes
that milestone's `threads`/`thread_messages`/category/forum-tag model already exists as described there.
Not itself a numbered milestone (M0–M5); tracked as its own GitHub issue (#261) since the original M5 doc
explicitly left it optional/unscoped ("Thread history view optional, same caveat as original plan").

## Status: planned 2026-07-27, not started

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
  storage. URL staleness is an accepted tradeoff for now (revisit later if it's a real problem).

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
current message page, keeping per-message rows lean). Shared enrichment helpers go in a new
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
  `SEGMENT_DEFINITIONS` entry for `['modmail', 'threads', ':id']` (label falls back to `Ticket #${id}` —
  threads have no name field).

Basic cursor "Load more" pagination is sufficient for this phase — no virtualization library yet.

## Phase 3 — Complete Discord-like view

- **Rendering**: start with a short research spike (don't assume a library exists — verify) into whether
  something like `discord-markdown` or a Discord-styled component library actually fits the bot's
  constrained message shape (plain markdown, at most one embed, files, no reactions/polls/components). If
  nothing fits cleanly, hand-roll a small set of components: `DiscordMarkdown.tsx`
  (mentions/emoji/channel-refs/formatting), `DiscordEmbed.tsx`, `DiscordAttachments.tsx` (image
  grid/lightbox, file chips), `MessageAuthorHeader.tsx` (avatar, consecutive-message grouping),
  `ReplyPreview.tsx` (Discord-accurate collapsed reply bar with click-to-jump). Extend the existing
  Discord-dark-theme token approach already in `panels/_components/PanelPreview.tsx` rather than
  reinventing colors.
- **Virtualization**: introduce `@tanstack/react-virtual` in `ThreadMessageList.tsx` once rendering is heavy
  enough per-message to matter at "thousands of messages" scale. This is also where the API's
  `direction: before/after` pagination (designed in Phase 1, used one-directionally in Phase 2) gets
  exercised properly — initial load jumps to the latest messages, older pages load on scroll-up.
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
  collapse/expand toggles correctly, a pre-recording message shows the "not recorded" placeholder.
- **Phase 3**: exercise a thread containing markdown, mentions, custom emoji, an embed, image and non-image
  attachments, and a native reply — confirm rendering matches what the bot actually posted to Discord;
  confirm virtualization keeps a very long thread's DOM bounded (spot-check via browser devtools node
  count) and scroll-up correctly loads older pages via `direction: before`.

## Open questions (not blocking, revisit if they come up during implementation)

1. Consent UX: is a single checkbox sufficient, or does the compliance weight of "recording all ticket
   conversations" warrant a stronger confirmation (modal, typed-confirmation input)?
2. Edit history: content is overwritten in place on a user edit, no version history — revisit if that turns
   out to matter (mirroring `snippet_updates`' pattern).
3. Retention/purge: no retention window or right-to-erasure sweep is in scope here — "recorded forever once
   opted in" is accepted for now; a `nukeDelayMinutes`-style retention window for recorded content could be
   a follow-up issue.
4. Roles/forum tags are live-fetched at request time (current state), not a point-in-time snapshot from
   when the ticket was active — confirm this stays desired as the feature gets used.
5. Pagination defaults (25 threads/page, 50 messages/page) are reasonable starting points but arbitrary —
   worth sanity-checking against real thread sizes before locking them into the public API contract.
