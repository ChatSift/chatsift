-- Modify "thread_messages" table
ALTER TABLE "thread_messages" ALTER COLUMN "user_message_id" DROP NOT NULL, ADD COLUMN "is_internal" boolean NOT NULL DEFAULT false;
