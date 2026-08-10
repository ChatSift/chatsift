-- Modify "ama_questions" table
ALTER TABLE "ama_questions" ADD COLUMN "asked_at" timestamptz NULL;
-- Backfill (hand-written, not part of atlas' generated diff): every path that sent a question set
-- `updated_at` in the same statement it set `state = 'ASKED'`, so for a question nobody has touched
-- since, `updated_at` *is* the send time. It's an approximation for anything edited/merged afterwards,
-- and the best one recoverable -- there's no other record of when a question was posted.
UPDATE "ama_questions" SET "asked_at" = "updated_at" WHERE "state" = 'ASKED';
