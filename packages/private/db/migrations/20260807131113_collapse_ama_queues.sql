-- Collapse mod review + guest review into a single queue, and remove flagging entirely.
-- Backfill existing rows before the enum swap below, while the old values are still valid:
-- flagged questions have no live queue left to sit in (closest terminal state is DENIED), and
-- pending-guest-review questions already passed the first stage, so they continue waiting in the
-- single unified queue.
UPDATE "ama_questions" SET "state" = 'DENIED' WHERE "state" = 'FLAGGED';
UPDATE "ama_questions" SET "state" = 'PENDING_MOD_REVIEW' WHERE "state" = 'PENDING_GUEST_REVIEW';
-- Postgres has no `ALTER TYPE ... DROP VALUE` -- swap to a fresh enum type instead.
ALTER TYPE "ama_question_state" RENAME TO "ama_question_state_old";
CREATE TYPE "ama_question_state" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DENIED', 'ASKED');
ALTER TABLE "ama_questions" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "ama_questions" ALTER COLUMN "state" TYPE "ama_question_state" USING (
  CASE "state"::text WHEN 'PENDING_MOD_REVIEW' THEN 'PENDING_REVIEW' ELSE "state"::text END
)::"ama_question_state";
ALTER TABLE "ama_questions" ALTER COLUMN "state" SET DEFAULT 'PENDING_REVIEW';
DROP TYPE "ama_question_state_old";
-- Modify "ama_questions" table
ALTER TABLE "ama_questions" RENAME COLUMN "mod_queue_message_id" TO "queue_message_id";
ALTER TABLE "ama_questions" DROP COLUMN "guest_queue_message_id", DROP COLUMN "flagged_queue_message_id";
-- Modify "ama_question_askers" table
ALTER TABLE "ama_question_askers" ADD COLUMN "content" text NULL;
-- Modify "ama_sessions" table
ALTER TABLE "ama_sessions" DROP CONSTRAINT "ama_sessions_flagged_queue_id_check", DROP CONSTRAINT "ama_sessions_mod_review_enabled_check";
ALTER TABLE "ama_sessions" RENAME COLUMN "mod_queue_id" TO "queue_id";
ALTER TABLE "ama_sessions" RENAME COLUMN "mod_review_enabled" TO "review_enabled";
ALTER TABLE "ama_sessions" DROP COLUMN "flagged_queue_id", DROP COLUMN "guest_queue_id";
ALTER TABLE "ama_sessions" ADD CONSTRAINT "ama_sessions_review_enabled_check" CHECK (review_enabled OR (queue_id IS NULL));
