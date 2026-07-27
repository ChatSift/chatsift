-- Modify "scheduled_thread_closes" table
ALTER TABLE "scheduled_thread_closes" ADD COLUMN "anon" boolean NOT NULL DEFAULT false;
