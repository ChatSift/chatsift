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
- `lib/resolvers/*` — custom discord.js-style option resolvers (`ChatInputInteractionOptionResolver`, `ModalInteractionOptionResolver`, `ContextMenuInteractionOptionResolver`, `AutocompleteInteractionOptionResolver`) — **built but not yet wired to any slash command handling.** There is currently no `ApplicationCommand` interaction routing in `index.ts`/gateway handling.

## Cluster 1 — Full question pipeline

The mod→guest→answers state machine exists; what's incomplete:

- [ ] **Guest-review queue** — confirm `postToGuestQueue` + its approve/deny component handlers are fully implemented and tested end-to-end (question submitted → mod-approved → lands in guest queue → guest-approved → answers channel). If guest-side component handlers (`guestApprove`/`guestDeny`) don't exist yet, add them mirroring `modApprove.ts`/`modDeny.ts`.
- [x] **Flagged/reported queue** — a "flag" action from the mod queue (`mod-flag` component) posts into the flagged channel and moves the question to a terminal `FLAGGED` state. Unlike the mod/guest queues, nothing routes back out of it via the bot: it's a read-only surface for mods to review reported content and act on the user directly through Discord's own moderation tools, not a pipeline stage.
- [ ] **End/close-AMA flow** — `AMASession.ended` exists in the schema but nothing flips it from the bot side yet (only via the API's `updateAMA` route, if at all). Add: a way to end an AMA (dashboard action calling `updateAMA` is likely sufficient — decide whether a bot-side command is also needed, see Cluster 2) that stops accepting new submissions (the "Submit a question" button should reject/disable once `ended`) and is reflected in the dashboard list ([03-dashboard-config.md](03-dashboard-config.md)'s `IncludeEndedToggle`/`AMASessionCard`).

## Cluster 2 — In-Discord slash commands

Resolvers exist; the command layer doesn't. Build:

- [ ] A command-handler loader mirroring `lib/components.ts` (glob `commands/**/*.js`, register `{ name, data, handle() }`).
- [ ] Wire `InteractionCreate` to route `ApplicationCommand` (and `ApplicationCommandAutocomplete`) interactions to it, alongside the existing `MessageComponent` routing.
- [ ] Command registration (bulk overwrite guild or global commands on boot — decide scope; guild-scoped is simpler to iterate on during development).
- [ ] Minimum command set for "fully running": `/ama create`, `/ama end`, `/ama repost-prompt`, `/ama stats` (ties into Cluster 4). Use the existing `ChatInputInteractionOptionResolver`/`ModalInteractionOptionResolver` for option parsing — they were built for exactly this and are currently unused.

## Cluster 3 — Answer-publishing polish

- [ ] Confirm `postToAnswersChannel`'s Components V2 formatting is final-quality (avatar, question text, any attachments via media gallery) — this is the host-facing/public-facing output, worth extra polish pass.
- [ ] **Repost prompt** — `repostPrompt` API route + `useRepostPrompt` hook exist; confirm the bot-side re-posts using the stored `AMAPromptData.promptJSONData` faithfully (raw vs. normal prompt mode, per `createAMA`'s `withRawPrompt`/`withRegularPrompt` schemas).
- [ ] **Edit/repost of published answers** — decide and implement: can a mod edit an already-answered question's published message (e.g. to fix a typo, or re-flag after the fact)? If yes, needs a component/command + a DB update path; if explicitly not supported this stage, document that decision here.

## Cluster 4 — Analytics & export

- [ ] **Per-AMA question-count stats** — `getAMAs` already returns `questionCount`; extend with a breakdown by `AMAQuestionState` (pending/flagged/approved/denied) for a real stats view.
- [ ] **Stats API route(s)** — new `defineRoute`-based endpoint(s) (per [02-foundation.md](02-foundation.md)'s pattern) surfacing per-AMA and possibly per-guild aggregate stats.
- [ ] **Dashboard stats view** — slot reserved in `AMADetails.tsx` per [03-dashboard-config.md](03-dashboard-config.md); build the actual charts/numbers here.
- [ ] **CSV export route** — a `defineRoute` endpoint returning a CSV (or a signed download) of all questions for an AMA (author, content, state, timestamps) — for moderators wanting an offline record.

## Verification

Run `services/ama-bot` + `services/api` against a test guild with all queue types configured (mod, guest, flagged). Exercise: submit a question → route through mod → guest → flagged (trigger each path at least once) → land in answers channel; run every new slash command; end an AMA and confirm submission is blocked afterward; repost the prompt; pull the stats view and the CSV export and confirm the data matches what was exercised.
