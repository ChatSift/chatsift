-- Modify "ama_questions" table
ALTER TABLE "ama_questions" ADD COLUMN "anonymous" boolean NOT NULL DEFAULT false;
