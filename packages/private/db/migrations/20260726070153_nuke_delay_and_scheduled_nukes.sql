-- Modify "guild_settings" table
ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_nuke_delay_minutes_check" CHECK (nuke_delay_minutes >= 1), ADD COLUMN "nuke_delay_minutes" integer NOT NULL DEFAULT 30;
-- Create "scheduled_thread_nukes" table
CREATE TABLE "scheduled_thread_nukes" (
  "thread_id" integer NOT NULL,
  "nuke_at" timestamptz NOT NULL,
  PRIMARY KEY ("thread_id"),
  CONSTRAINT "scheduled_thread_nukes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
