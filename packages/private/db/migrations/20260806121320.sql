-- Modify "ama_sessions" table
ALTER TABLE "ama_sessions" DROP CONSTRAINT "ama_sessions_guest_review_enabled_check", DROP COLUMN "guest_review_enabled", ADD COLUMN "guest_ids" text[] NOT NULL DEFAULT '{}';
