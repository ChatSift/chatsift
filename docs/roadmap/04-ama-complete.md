# M3 — AMA fully running spec

**Milestone target:** ~2026-11-05 (7 weeks from M2 completion at ~7 hrs/wk). **Depends on:** M1 (foundation). **Can interleave with:** M2. **Blocks:** M4 (drain-and-swap can't happen until AMA is feature-complete on the new stack).

## Goal

"Fully running" means all four clusters below are done. This is the largest milestone in the beginning stage — plan for it to take the longest and to interleave with M2's config-UI work (a feature here often needs a config screen there).

## Current state (`services/ama-bot/src/`)

A gateway bot (`@discordjs/ws` WebSocketManager + `@discordjs/core` Client, Guilds intent), not an interactions-webhook bot. Key files:

- `lib/gateway.ts`, `lib/client.ts` — connection + guild-list tracking (writes guild IDs to Redis every 10s so the API knows which guilds the bot is in).
- `lib/components.ts` — globs `components/**/*.js`, registers `ComponentHandler` classes (`{ name, stateStore, handle() }`); `custom_id` format is `name:stateId` with optional Redis-backed state.
- `lib/collector.ts` — `collectModal(id, waitFor)` for awaiting a modal submission.
- `lib/queues.ts` — the core domain logic:
  - `enum CurrentlyInQueue { mod, guest, answers }` + `getNextQueue()` — a state machine: **mod queue → (optional) guest queue → answers channel**, with an optional **flagged queue** side-branch.
  - `postToModQueue` / `postToGuestQueue` / `postToFlaggedQueue` / `postToAnswersChannel` — builder functions constructing Components V2 (`ContainerBuilder`) messages (text + avatar thumbnail + media gallery for attachments) with the right Approve/Deny/Flag/Skip buttons per queue.
- `components/submitQuestion.ts` — user clicks "Submit a question" on the prompt message → opens a modal (text + optional uploads, gated by `allowedQuestionUploads`) → collects modal → inserts `AMAQuestion` → routes into mod/guest/answers per which queues are configured.
- `components/modApprove.ts` / `modDeny.ts` — parse question ID from `custom_id`, advance/deny via `getNextQueue`, disable buttons on the source message.
- `components/guestApprove.ts` / `guestSkip.ts` — guest-side mirror of the mod handlers (#139): resolve the question, post to the answers channel, atomically claim the row (`WHERE state = 'PENDING_GUEST_REVIEW'`), clean up a lost claim race, reject if the session has ended.
- `lib/commands.ts` — command-handler loader mirroring `lib/components.ts` (glob `commands/**/*.js`, register `{ name, data, handle, handleAutocomplete? }`); `index.ts` routes `ApplicationCommand` and `ApplicationCommandAutocomplete` interactions to it. Built in #142 (PR #191).
- `commands/deploy.ts` — the only command implemented so far: admin-gated (`env.ADMINS`), bulk-overwrites **global** commands (`bulkOverwriteGlobalCommands`) from every registered handler's `data`. The scope question Cluster 2 originally left open ("guild-scoped is simpler to iterate on") was decided in favor of **global-only** — there is no per-guild registration path, so any new command handler's `data` is picked up automatically by the next `/deploy` run.
- Option parsing no longer uses a hand-rolled resolver — `lib/resolvers/*` was deleted in #142/PR #191 and replaced with `@sapphire/discord-utilities`'s `ChatInputInteractionOptionResolver` / `ModalInteractionOptionResolver` / `ContextMenuInteractionOptionResolver` / `AutocompleteInteractionOptionResolver` (equivalent API, external dependency instead of in-repo code). `components/submitQuestion.ts` already uses `ModalInteractionOptionResolver` from that package as the reference example.

## Cluster 1 — Full question pipeline

The mod→guest→answers state machine exists; what's incomplete:

- [x] **Guest-review queue** (#139) — `guestApprove.ts`/`guestSkip.ts` exist and mirror `modApprove.ts`/`modDeny.ts`: question submitted → mod-approved → lands in guest queue → guest-approved → answers channel, with the same atomic-claim/lost-race cleanup pattern.
- [x] **Flagged/reported queue** — a "flag" action from the mod queue (`mod-flag` component) posts into the flagged channel and moves the question to a terminal `FLAGGED` state. Unlike the mod/guest queues, nothing routes back out of it via the bot: it's a read-only surface for mods to review reported content and act on the user directly through Discord's own moderation tools, not a pipeline stage.
- [x] **End/close-AMA flow** (#141) — `updateAMA`'s `ended` branch flips the flag from the dashboard; `submitQuestion.ts` rejects new submissions once `ama.ended`, and `guestApprove`/`modApprove` etc. reject further action on an ended session. Reflected in the dashboard list via M2's `IncludeEndedToggle`/`AMASessionCard`. The bot-side `/ama end` command is implemented too, see Cluster 2.

## Cluster 2 — In-Discord slash commands

Command-handler infra is done (#142, PR #191): `lib/commands.ts` mirrors `lib/components.ts`'s loader, `index.ts` routes `ApplicationCommand`/`ApplicationCommandAutocomplete` interactions to it, and registration is a **global** bulk overwrite via the admin-only `/deploy` command (see "Current state" above). What's left is the actual `/ama` command set — this is #143's remaining scope. Use `@sapphire/discord-utilities`'s `ChatInputInteractionOptionResolver`/`ModalInteractionOptionResolver` for option parsing (the in-repo resolvers this doc used to point to were deleted in favor of that package).

Owner decisions for the four subcommands (given without re-reading this doc first, so treat as authoritative over the original one-liners below):

- [x] **`/ama create`** — deliberately **not** a creation flow. Implemented as `commands/ama.ts`'s `create` subcommand: an ephemeral reply linking to the dashboard's AMA-create screen (`${FRONTEND_URL}/dashboard/:guildId/ama/amas/new`), nothing more. **Unverified end-to-end** — build+lint are green but this hasn't been click-tested against a live guild yet (see Verification).
  - **Deferred idea (not M3 scope):** a future version could reply with a link carrying a scoped JWT that asserts "this Discord user ID has some privilege level on this guild" — both facts already proven by the user having been able to run the slash command in that guild. This would need (a) a new, more granular grant model on the frontend (e.g. "can start an AMA" rather than full server-admin/full-dashboard-grant), (b) a new token type and verification path, and (c) UI to consume it. Complex enough to warrant its own milestone-sized slice later (M4+/backlog) — do not attempt it as part of #143.
- [x] **`/ama end`** — implemented: `commands/ama.ts`'s `end` subcommand replies with an ephemeral string-select listing the guild's ongoing (`ended = false`) sessions (max 25, Discord's select cap — fine for now, revisit pagination if a guild ever runs more concurrent AMAs than that); `components/amaEndSelect.ts` handles the selection, flips `ended` the same way `updateAMA`'s `ended` branch does (direct DB write, no HTTP call to `services/api`). **Unverified end-to-end**, see Verification.
- [x] **`/ama repost-prompt`** — implemented: same select-menu UX (`components/amaRepostSelect.ts`), reusing `repostPrompt.ts`'s exact guard/replay/concurrency-safe-update logic but re-implemented against the bot's own `@discordjs/core` REST client (`getContext().service.client.api`) instead of the API's `discordAPIAma` (`@discordjs/rest`-based) client — the two clients aren't interchangeable, so this is a deliberate duplication, not an oversight; flagged inline in both files if either changes independently. **Unverified end-to-end**, see Verification.
- [ ] **`/ama stats`** — **excluded from #143's scope**, not implemented. Cluster 4 (the stats/analytics data model and API surface) hasn't started (#146, #147 still open); a `/ama stats` command would either duplicate query logic that Cluster 4 is about to build properly or ship a throwaway version. Revisit once #146 lands.

## Cluster 3 — Answer-publishing polish (#144, #145)

- [x] **Mod/guest/flagged-queue + answers-channel formatting** — ported from Components V2 (`ContainerBuilder`) to classic embeds, matching prod `ChatSift/AMA`'s `AmaManager.getBaseEmbed` layout exactly: author name+avatar line, blurple `0x7289da`, footer with `username (id)` only on the mod/flagged queues (where a mod needs the raw ID to act), no footer on guest queue/answers channel. Confirmed live against the test guild (guild `1425493115053019319`, channel `1425493115736817756`) before implementing — CV2 variants (accent color, separators) were also trialed and rejected in favor of matching prod. `getBaseEmbeds` in `services/ama-bot/src/lib/queues.ts` also adds gallery-grouping (same-`url` trick) for >1 attachment, which prod never needed since it only supported a single legacy `imageUrl`.
- [x] **Repost prompt** — confirmed: `components/amaRepostSelect.ts` replays the stored `AmaPromptData.promptJsonData` verbatim regardless of raw/normal prompt mode, so faithfulness is structural (it never re-derives the message body, just re-POSTs the exact bytes captured at `createAMA` time) rather than something needing a runtime check.
- [ ] **Edit/repost of published answers (#145) — scope gap found, deferred, and not to be implemented regardless.** Prod `ChatSift/AMA` never posts "the answer" via `postToAnswersChannel` alone: that call only forwards the *question* (author=asker, description=question text). The actual answer is added as a **separate manual step** — a mod right-clicks the answers-channel message → **"Add Answer"** context-menu command → modal (answer text, optional image, optional "answered by" override) → appends a second embed onto the same live Discord message. Neither prod's Prisma schema nor `main`'s `ama_questions` table persists answer text anywhere — it only ever lives on the Discord message itself (both just store a message-ID pointer: prod's `answerMessageId`, main's `answers_message_id`). **This "Add Answer" feature has never been ported to `main` at all** — there is currently no way to attach an answer to a forwarded question. Owner decision (2026-07-19, reaffirmed): defer porting Add Answer as a separate follow-up issue rather than expanding #144/#145's scope, **and** editing/reposting a published answer is out of scope for this stage regardless of whether Add Answer ever lands — manual Discord message edit/delete is sufficient. Not blocked-and-revisit; explicitly not doing this.

## Cluster 4 — Analytics & export (#146, #147)

- [ ] **Per-AMA question-count stats** — `getAMAs` already returns `questionCount`; extend with a breakdown by `AMAQuestionState` (pending/flagged/approved/denied) for a real stats view.
- [ ] **Stats API route(s)** — new `defineRoute`-based endpoint(s) (per [02-foundation.md](02-foundation.md)'s pattern) surfacing per-AMA and possibly per-guild aggregate stats.
- [ ] **Dashboard stats view** — slot reserved in `AMADetails.tsx` per [03-dashboard-config.md](03-dashboard-config.md); build the actual charts/numbers here.
- [ ] **CSV export route** — a `defineRoute` endpoint returning a CSV (or a signed download) of all questions for an AMA (author, content, state, timestamps) — for moderators wanting an offline record.
- Not started; `/ama stats` (Cluster 2) is intentionally deferred until this lands, per owner decision.

## Verification

Run `services/ama-bot` + `services/api` against a test guild with all queue types configured (mod, guest, flagged). Exercise: submit a question → route through mod → guest → flagged (trigger each path at least once) → land in answers channel; run every new slash command; end an AMA and confirm submission is blocked afterward; repost the prompt; pull the stats view and the CSV export and confirm the data matches what was exercised.
