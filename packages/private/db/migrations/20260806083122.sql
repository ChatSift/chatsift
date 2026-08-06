-- Flagging only ever happens from PENDING_MOD_REVIEW, so a flagged_queue_id with mod review disabled is
-- dead config left over from before mod_review_enabled existed -- clear it before the CHECK below.
UPDATE "ama_sessions" SET "flagged_queue_id" = NULL WHERE NOT "mod_review_enabled" AND "flagged_queue_id" IS NOT NULL;
-- Modify "ama_sessions" table
ALTER TABLE "ama_sessions" ADD CONSTRAINT "ama_sessions_flagged_queue_id_check" CHECK (mod_review_enabled OR (flagged_queue_id IS NULL));
