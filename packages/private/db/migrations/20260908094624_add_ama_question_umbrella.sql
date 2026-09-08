-- Modify "ama_questions" table
ALTER TABLE "ama_questions" ADD COLUMN "umbrella" boolean NOT NULL DEFAULT false, ADD COLUMN "show_asker_count" boolean NOT NULL DEFAULT true;
