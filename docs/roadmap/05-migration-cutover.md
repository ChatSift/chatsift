# M4 — AMA drain-and-swap runbook (no data migration)

**Depends on:** M3 (done, 2026-07-19 — AMA fully running on the new stack). **Live production impact:** yes — this is the first user-facing cutover.

> For ModMail's migration (which **is** a real data migration), see [06-modmail-port.md](06-modmail-port.md).

## Status: cutover dates are public

Unlike M4's original hypothetical runbook, the cutover is no longer a plan to schedule — it was announced in the support server on **2026-07-22** and the dates below are commitments made to users, not estimates:

| Date                        | Event                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **2026-07-22** (done)       | `AMA Canary` (new stack, client ID `1427232824854970409`) deployed and publicly invitable. Feedback/bug-report window opens. |
| **2026-08-03**              | Kill-switch: **AMA creation becomes unavailable** on the live `@AMA#5595` bot. In-flight AMAs are unaffected.                |
| **2026-08-03 → 2026-08-08** | Drain window (~5 days, not the original runbook's ~1 week estimate).                                                         |
| **2026-08-08**              | Cutover: new codebase deployed to replace the live bot. AMA creation returns, now on the new stack.                          |

The ~3-week "polishing & feedback" period referenced in the announcement is the wider window (2026-07-22 → roughly mid-August) during which Canary stays up for bug reports even after the 08-08 cutover — it is not the same interval as the 5-day drain window above, which only covers the kill-switch-to-cutover gap.

## Decision: why AMA doesn't need a data migration

AMA sessions are inherently short-lived events (a single Q&A window), not durable records users expect to persist indefinitely like ModMail threads. Rather than write and validate a transform script for a old-`Ama`/`AmaQuestion` → new-`AMASession`/`AMAQuestion` schema mismatch (see the field diff below), the simpler and lower-risk path is a **drain-and-swap**: stop new AMAs from starting on the old bot, let whatever's in-flight finish naturally, then deploy the new bot. Old AMA data is left behind in the old database (kept as a cold backup, not migrated).

## Old schema (reference only — NOT a migration source)

From `ChatSift/AMA`'s `prisma/schema.prisma` (captured 2026-07-16, for parity/reference during M3 feature work, not for transformation):

```prisma
model Ama {
  id              Int     @id @default(autoincrement())
  guildId         String
  modQueue        String?
  flaggedQueue    String?
  guestQueue      String?
  title           String
  answersChannel  String
  promptChannelId String
  promptMessageId String  @unique
  stageOnly       Boolean @default(false) // deprecated
  ended           Boolean @default(false)
  createdAt       DateTime @default(now())
  questions       AmaQuestion[]
}

model AmaQuestion {
  id              Int     @id @default(autoincrement())
  amaId           Int
  ama             Ama     @relation(fields: [amaId], references: [id], onDelete: Cascade)
  authorId        String
  content         String
  imageUrl        String?
  answerMessageId String?
}
```

Compare against the new schema ([01-architecture.md](01-architecture.md) §5): the new `AMASession`/`AMAQuestion` has richer state tracking (`AMAQuestionState` enum, per-queue message IDs, `AMAPromptData` split out, `allowedQuestionUploads`) that the old schema doesn't carry. This gap is exactly why drain-and-swap (not migration) was chosen — transforming old rows into the new shape would require inventing state that was never recorded (e.g. which queue a question is currently sitting in).

## What changed for users (context for support/feedback triage during the window)

Per the 2026-07-22 announcement, worth knowing while triaging bug reports on the feedback thread:

- **No more slash-command config.** All configuration moves to the dashboard (`https://canary.automoderator.app` during the Canary window; same domain the live bot will use post-cutover). Dashboard access is gated by "Manage Server"/Administrator, plus additive per-`userId` grants via `DashboardGrant` (already shipped, M1) — a server can hand out dashboard access without giving Discord-level management permissions.
- **Hot actions still have slash commands** — they just generate a one-time grant-token dashboard URL instead of doing the action in Discord directly (`/ama create`, per [01-architecture.md §4a](01-architecture.md#4a-grant-token-auth-one-time-scoped-194)). This is the pattern to point users at if they ask "why can't I just configure it in Discord."
- **Feature parity is intentionally incomplete.** Confirmed gaps: no "Add Answer" context-menu flow yet (#200, open, unscheduled) and no `/ama stats` slash command (dashboard stats view exists, M3 Cluster 4). Both are known, not bugs to re-report.
- **New:** raw-JSON prompt authoring mode for AMA creation, in addition to the guided form.

## Runbook

1. **Pre-check (done):** M3's acceptance criteria met, Canary deployed and invitable.
2. **Feedback window (in progress, 2026-07-22 → cutover):** triage bug reports from the support-server thread; fix blockers on Canary before 2026-08-03. Config/UX gaps that are "intentionally incomplete" per the announcement (see above) are not blockers.
3. **Kill-switch on old prod (`ChatSift/AMA`), 2026-08-03:** ship a small change (or flip a config flag if one exists) disabling **new AMA creation** only — existing in-flight AMAs continue to function normally (submissions, mod/guest review, answers) so nothing breaks mid-event.
4. **Drain window, 2026-08-03 → 2026-08-08:** monitor old prod for AMAs still marked `ended: false`.
5. **Cutover, 2026-08-08:**
   - Deploy `services/ama-bot` + `services/api` (new stack) to production infrastructure, replacing the live `@AMA#5595` deployment.
   - **Decide and execute the token strategy** — either point `@AMA#5595`'s existing Discord application/token at the new deployment (no re-invite needed for existing servers), or promote the Canary application (`1427232824854970409`) to be the new production identity and coordinate a re-invite. The announcement doesn't commit to which; pick whichever preserves existing server integrations with the least friction and confirm before this step.
   - Smoke-test: create a real AMA on a real server, submit a question, run it through the full pipeline.
6. **Decommission old:** once the new deployment is confirmed stable (a few days of monitoring), stop the old `ChatSift/AMA` deployment. **Do not delete its database immediately** — keep it as a cold, read-only backup for some reasonable retention window (e.g. 90 days) in case any parity gap surfaces.
7. **Canary's future:** decide whether the Canary deployment stays up permanently as a standing pre-prod/staging environment (useful precedent for M5's ModMail rollout) or gets decommissioned once its one job here is done — not yet decided, flag before 2026-08-08.
8. **Rollback plan:** if the new deployment has a critical issue post-cutover, the old deployment is kept warm (not deleted) until confidence is established, so reverting the token/deployment pointer is the rollback path — no data to restore since nothing was migrated.

## Verification

- Kill-switch confirmed (2026-08-03): attempting to create a new AMA on old prod fails/is blocked, existing AMAs unaffected.
- New deployment smoke-tested end-to-end on a real (or dedicated test) server before wide traffic.
- Old deployment decommissioned only after a stable monitoring period, database retained as cold backup for the agreed retention window.
