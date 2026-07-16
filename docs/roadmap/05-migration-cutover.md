# M4 — AMA drain-and-swap runbook (no data migration)

**Milestone target:** ~2026-11-19 (~1 week of effort + ~1 week drain window, after M3). **Depends on:** M3 (AMA must be fully running on the new stack before cutover). **Live production impact:** yes — this is the first user-facing cutover.

> For ModMail's migration (which **is** a real data migration), see [06-modmail-port.md](06-modmail-port.md).

## Decision: why AMA doesn't need a data migration

AMA sessions are inherently short-lived events (a single Q&A window), not durable records users expect to persist indefinitely like ModMail threads. Rather than write and validate a transform script for a old-`Ama`/`AmaQuestion` → new-`AMASession`/`AMAQuestion` schema mismatch (see the field diff below), the simpler and lower-risk path is a **drain-and-swap**: stop new AMAs from starting on the old bot, let whatever's in-flight finish naturally within about a week, then deploy the new bot. Old AMA data is left behind in the old database (kept as a cold backup, not migrated).

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

## Runbook

1. **Pre-check:** confirm M3's acceptance criteria are met (all four clusters verified against a test guild).
2. **Kill-switch on old prod (`ChatSift/AMA`):** ship a small change (or flip a config flag if one exists) disabling **new AMA creation** only — existing in-flight AMAs continue to function normally (submissions, mod/guest review, answers) so nothing breaks mid-event.
3. **Drain window (~1 week):** monitor old prod for AMAs still marked `ended: false`. Communicate the cutover date to affected server admins if there's a channel to do so.
4. **Cutover:**
   - Deploy `services/ama-bot` + `services/api` (new stack) to production infrastructure.
   - Point the AMA bot's Discord token at the new deployment (either reuse the existing bot application/token, or — if a new application was created for the rebuild — coordinate the token swap and any re-invite requirements with affected servers).
   - Smoke-test: create a real AMA on a real server, submit a question, run it through the full pipeline.
5. **Decommission old:** once the new deployment is confirmed stable (a few days of monitoring), stop the old `ChatSift/AMA` deployment. **Do not delete its database immediately** — keep it as a cold, read-only backup for some reasonable retention window (e.g. 90 days) in case any parity gap surfaces.
6. **Rollback plan:** if the new deployment has a critical issue post-cutover, the old deployment is kept warm (not deleted) until confidence is established, so reverting the token/deployment pointer is the rollback path — no data to restore since nothing was migrated.

## Verification

- Kill-switch confirmed: attempting to create a new AMA on old prod fails/is blocked, existing AMAs unaffected.
- New deployment smoke-tested end-to-end on a real (or dedicated test) server before wide traffic.
- Old deployment decommissioned only after a stable monitoring period, database retained as cold backup for the agreed retention window.
