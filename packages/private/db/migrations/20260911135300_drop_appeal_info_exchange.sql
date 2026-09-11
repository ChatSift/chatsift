-- Hand-written: postgres cannot drop a value from an enum, so Atlas refuses to diff this outright
-- ("dropping value \"NEEDS_MORE_INFO\" from enum \"appeal_status\" is not supported"). Both types are
-- recreated instead.
--
-- Removes the ask-for-more-info exchange (#232 P4). The button that produced it was cut before it shipped:
-- `appeal_events` is never served to the appellant, so a follow-up question had nowhere to be read and its
-- answer had nowhere to come from. Nothing has ever written any of these three values -- the only writer of
-- `appeals.status` past 'PENDING' is the decision path landing in this same change -- so the casts below
-- rewrite no rows, and a row that somehow did carry one would abort the migration rather than be coerced.

-- Recreate "appeal_status" without 'NEEDS_MORE_INFO'
ALTER TABLE "appeals" DROP CONSTRAINT "appeals_decision_check";
ALTER TABLE "appeals" DROP CONSTRAINT "appeals_silent_check";
DROP INDEX "appeals_open_per_user_idx";
DROP INDEX "appeals_guild_id_status_id_idx";
ALTER TABLE "appeals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "appeal_status" RENAME TO "appeal_status_old";
CREATE TYPE "appeal_status" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'WITHDRAWN');
ALTER TABLE "appeals" ALTER COLUMN "status" TYPE "appeal_status" USING "status"::text::"appeal_status";
ALTER TABLE "appeals" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "appeal_status_old";
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_silent_check" CHECK (NOT silent OR status = 'DENIED');
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_check" CHECK (
  CASE status
    WHEN 'PENDING' THEN decided_at IS NULL AND decided_by_id IS NULL AND decision_reason IS NULL
    WHEN 'APPROVED' THEN decided_at IS NOT NULL AND decided_by_id IS NOT NULL
    WHEN 'DENIED' THEN decided_at IS NOT NULL AND decided_by_id IS NOT NULL
    WHEN 'WITHDRAWN' THEN decided_at IS NOT NULL AND decided_by_id IS NULL
    ELSE false
  END
);
CREATE UNIQUE INDEX "appeals_open_per_user_idx" ON "appeals" ("guild_id", "user_id", "kind") WHERE status = 'PENDING';
CREATE INDEX "appeals_guild_id_status_id_idx" ON "appeals" ("guild_id", "status", "id" DESC);

-- Recreate "appeal_event_kind" without 'INFO_REQUESTED'/'INFO_PROVIDED'
ALTER TYPE "appeal_event_kind" RENAME TO "appeal_event_kind_old";
CREATE TYPE "appeal_event_kind" AS ENUM ('SUBMITTED', 'APPROVED', 'DENIED', 'WITHDRAWN', 'NOTE');
ALTER TABLE "appeal_events" ALTER COLUMN "kind" TYPE "appeal_event_kind" USING "kind"::text::"appeal_event_kind";
DROP TYPE "appeal_event_kind_old";
