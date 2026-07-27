-- Modify "guild_settings" table
ALTER TABLE "guild_settings" ADD COLUMN "record_thread_content" boolean NOT NULL DEFAULT false, ADD COLUMN "record_thread_content_enabled_by" text NULL, ADD COLUMN "record_thread_content_enabled_at" timestamptz NULL;
-- Create "thread_message_content" table
CREATE TABLE "thread_message_content" (
  "thread_message_id" integer NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "replied_to_thread_message_id" integer NULL,
  "is_forwarded" boolean NOT NULL DEFAULT false,
  "attachments" jsonb NOT NULL DEFAULT '[]',
  "stickers" jsonb NOT NULL DEFAULT '[]',
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_message_id"),
  CONSTRAINT "thread_message_content_replied_to_thread_message_id_fkey" FOREIGN KEY ("replied_to_thread_message_id") REFERENCES "thread_messages" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "thread_message_content_thread_message_id_fkey" FOREIGN KEY ("thread_message_id") REFERENCES "thread_messages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "thread_message_content_replied_to_idx" to table: "thread_message_content"
CREATE INDEX "thread_message_content_replied_to_idx" ON "thread_message_content" ("replied_to_thread_message_id") WHERE (replied_to_thread_message_id IS NOT NULL);
