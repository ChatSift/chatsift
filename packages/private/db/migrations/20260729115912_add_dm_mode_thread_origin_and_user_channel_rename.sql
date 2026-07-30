-- Modify "guild_settings" table
ALTER TABLE "guild_settings" ADD COLUMN "dm_mode" boolean NOT NULL DEFAULT false;
-- Modify "threads" table
ALTER TABLE "threads" RENAME COLUMN "user_thread_id" TO "user_channel_id";
ALTER TABLE "threads" ADD COLUMN "origin" text NOT NULL DEFAULT 'panel', ADD CONSTRAINT "threads_origin_check" CHECK (origin = ANY (ARRAY['panel'::text, 'dm'::text]));
-- Rename index "threads_user_thread_id_idx" to "threads_user_channel_id_idx" (column renamed above; the index
-- itself isn't renamed by a plain column rename)
ALTER INDEX "threads_user_thread_id_idx" RENAME TO "threads_user_channel_id_idx";
