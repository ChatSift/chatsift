# M6 — AMA: prepared answers, dashboard question triage, tags, duplicate merging

**Milestone target:** none announced — this is a feature request (via Tommy, relaying a NASCAR-guild moderator), not a public commitment like M4's. **Depends on:** M3 (AMA fully running) — done. **Live production impact:** yes, and it lands while M4's drain-and-swap cutover window is still open (2026-08-08) — a deliberate, informed overlap the owner chose to accept rather than an oversight; see [05-migration-cutover.md](05-migration-cutover.md).

## Status: implemented 2026-08-06, pending live verification

Schema, bot, API, and dashboard work described below is written. What's outstanding is the manual end-to-end verification pass against a real test guild (per [docs/workflow.md](../workflow.md)'s standard) before this is folded into [01-architecture.md](01-architecture.md) the way M1–M3/#261/#216 were.

> **Superseded (2026-08-07):** before this ever got its live-verification pass, the two-stage mod-queue/guest-queue pipeline and the `FLAGGED` state described below were both simplified away — see the "collapse AMA queues" change on `refactor/ama-queues`. Guests now review the same single queue as mods via scoped dashboard access instead of a dedicated Discord channel, and flagging (a dead-end with no forward path) was removed outright. The **prepared answers / tags / duplicate-merging** feature set this doc covers is otherwise still accurate and shipped as designed — only the queue-routing/state-machine parts below are historical. Current model lives in [01-architecture.md §5-6](01-architecture.md#5-data-model-reference-6-models).

## Why

Three related asks arrived together:

1. **Dashboard question triage** — browse/sort AMA questions by state (pending review / approved / asked), which didn't exist before (the dashboard only had aggregate stats + CSV export).
2. **Prepared answers** — decouple approving a question from posting it, so a host can pre-load an answer (accessibility: people who can't hear the speaker, or don't understand the language, can read along) and pace a live show.
3. **Tags + duplicate merging** — per-AMA-session freeform tags for mod-side organization, plus a separate, more structured "mark as duplicate" flow.

This directly revives issue #200 ("port prod's Add Answer flow"), dropped 2026-07-25 — but the shape here is materially different (decoupled send, per-AMA opt-in, dashboard-first) rather than prod's simple post-hoc context-menu edit.

## Design decisions (owner sign-off, this session)

- **Prepared answers are opt-in per AMA session** (`ama_sessions.prepared_answers_enabled`), not a global behavior change — existing sessions are unaffected by default.
- On Discord, when the toggle is on, the **guest queue's Approve button becomes "Add Answer"** (a modal: answer text, optional image URL, optional answered-by override), replacing the immediate-post behavior. The answer embed design is lifted from prod `ChatSift/AMA`'s `add-answer.ts` (description = answer text, optional image, footer `"{name} answered"` + avatar, blurple).
- Answers can also be added/edited from the dashboard, independent of the Discord modal.
- **Full question triage (approve/deny/flag/send) is available from the dashboard**, not just Discord.
- **Tags** are per-AMA-session scoped, freeform, many-per-question, and **dashboard-only** — Discord's component model (25-option-capped select menus, no combined create+select interaction) doesn't support a workable in-Discord tagging UX.
- **Duplicates are a separate, more opinionated feature from tags**: mark question A as a duplicate of question B → A is deleted, B gains A's asker → B renders as "Asked by X, Y, Z [...and N more]" → same flow exists in Discord (button + modal search + select) as well as the dashboard.
- **Dash-only review stages**: mod queue and guest queue each got an explicit "enable this stage" boolean (`mod_review_enabled`/`guest_review_enabled`), independent of whether a Discord channel is picked. Off = stage skipped entirely (today's behavior when the channel is unset). On with no channel = the stage still happens but is only actionable from the dashboard. On with a channel = unchanged Discord-queue behavior. Submission (prompt channel) and final publishing (answers channel) stay Discord-only, `NOT NULL`, no toggle — the owner was explicit that those two "cannot be dash-only."
- **Public answers page**: every AMA (not just dash-only-queue ones) gets a read-only, no-login page (`/ama-answers/:shareToken`) mirroring the answers channel, for people without server access.
- The question list has three first-class entry points — all questions by a user, all questions under a tag, all questions in a state — implemented as one filtered/paginated list rather than three separate screens; any tag chip, author name, or state badge in the list is clickable to jump into that filter.

## Schema

New `ama_sessions` columns: `prepared_answers_enabled`, `mod_review_enabled`, `guest_review_enabled` (all booleans, backfilled from whether the corresponding queue channel was already set — preserves every existing AMA's behavior exactly), `share_token` (opaque id for the public page, backfilled for existing rows).

New `ama_question_state` value: `'ASKED'`. Going forward, `ASKED` is the only state meaning "posted to the answers channel" — `APPROVED` means "approved, not necessarily posted" when prepared answers is on.

New `ama_questions` columns: `answer_content`, `answer_image_url`, `answered_by_id`, `answered_at` (all nullable — a question can be `APPROVED` with no answer prepared yet).

New tables: `ama_question_askers` (duplicate-merge target, records who else asked a merged-away question), `ama_question_tags` (session-scoped freeform tags), `ama_question_tag_assignments` (join table).

See `packages/private/db/schema/schema.sql` for the full column/constraint definitions, and migration `20260806073414.sql` for the backfill logic.

## Where the code lives

- Shared pure embed/routing helpers (`getBaseEmbeds`, `getAnswerEmbed`, `getNextQueue`, `CurrentlyInQueue`): `packages/private/core/src/lib/amaEmbeds.ts` — used by both `services/ama-bot` (`lib/queues.ts`) and `services/api` (the new question routes), since `services/api` already posts to Discord directly via its own token-bound client (`discordAPIAma`).
- Bot-side behavior changes: `services/ama-bot/src/components/{submitQuestion,modApprove,guestApprove}.ts`; new `guestAddAnswer.ts`, `markDuplicate.ts`, `markDuplicateSelect.ts`.
- API routes: `services/api/src/routes/ama/questions/{listQuestions,getQuestion,updateQuestion,sendQuestion,mergeQuestion,publicAnswers}.ts`, `services/api/src/routes/ama/tags/{listTags,createTag}.ts`.
- Dashboard: `apps/website/src/app/dashboard/[id]/ama/amas/[amaId]/questions/` (list + filters + per-question detail/actions), `apps/website/src/app/ama-answers/[shareToken]/` (public page, outside the authenticated dashboard tree), plus the dash-only-stage checkboxes and prepared-answers toggle in `CreateAMAForm.tsx`/`AMADetails.tsx`.

## Verification

Not yet run against a live test guild. Needed before this doc is folded into [01-architecture.md](01-architecture.md):

- Both `prepared_answers_enabled` modes (off = byte-for-byte unchanged pipeline; on = hold-then-send, both from the mod queue and the guest queue's "Add Answer" modal).
- Dashboard-only triage (approve/deny/flag with no Discord interaction) on a session with a dash-only-enabled stage.
- Duplicate merging from both the dashboard and the Discord button+modal+select flow.
- Tag creation/filtering, and filtering by clicking a tag/author/state chip from within the list.
- Backward compatibility: an AMA created before this change keeps behaving exactly as before the migration.
- The public answers page renders with no login and no raw Discord IDs.
- CSV re-export includes the new columns correctly escaped.
