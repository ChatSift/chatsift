-- Modify "snippet_updates" table
ALTER TABLE "snippet_updates" ADD COLUMN "old_name" text NULL, ADD COLUMN "old_attachment_url" text NULL, ADD COLUMN "old_attachment_filename" text NULL;
