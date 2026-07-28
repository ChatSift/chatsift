-- Modify "thread_messages" table
ALTER TABLE "thread_messages" ADD COLUMN "is_system" boolean NOT NULL DEFAULT false;
