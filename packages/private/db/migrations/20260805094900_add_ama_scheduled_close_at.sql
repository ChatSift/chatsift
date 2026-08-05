-- Modify "ama_sessions" table
ALTER TABLE "ama_sessions" ADD COLUMN "scheduled_close_at" timestamptz NULL;
