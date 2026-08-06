-- Modify "ama_questions" table
ALTER TABLE "ama_questions" ADD CONSTRAINT "ama_questions_id_ama_id_key" UNIQUE ("id", "ama_id");
-- Modify "ama_sessions" table
ALTER TABLE "ama_sessions" ALTER COLUMN "share_token" SET NOT NULL;
-- Modify "ama_question_tags" table
ALTER TABLE "ama_question_tags" ADD CONSTRAINT "ama_question_tags_id_ama_id_key" UNIQUE ("id", "ama_id");
-- Modify "ama_question_tag_assignments" table
ALTER TABLE "ama_question_tag_assignments" DROP CONSTRAINT "ama_question_tag_assignments_question_id_fkey", DROP CONSTRAINT "ama_question_tag_assignments_tag_id_fkey", ADD COLUMN "ama_id" integer;
-- Backfill existing rows from the question they're attached to -- the application already only ever
-- assigns a tag to a question in the same AMA (see updateQuestion.ts), so this is never ambiguous.
UPDATE "ama_question_tag_assignments" ta SET "ama_id" = q."ama_id" FROM "ama_questions" q WHERE q."id" = ta."question_id";
ALTER TABLE "ama_question_tag_assignments" ALTER COLUMN "ama_id" SET NOT NULL, ADD CONSTRAINT "ama_question_tag_assignments_question_fkey" FOREIGN KEY ("question_id", "ama_id") REFERENCES "ama_questions" ("id", "ama_id") ON UPDATE NO ACTION ON DELETE CASCADE, ADD CONSTRAINT "ama_question_tag_assignments_tag_fkey" FOREIGN KEY ("tag_id", "ama_id") REFERENCES "ama_question_tags" ("id", "ama_id") ON UPDATE NO ACTION ON DELETE CASCADE;
-- Create index "ama_question_tag_assignments_ama_id_idx" to table: "ama_question_tag_assignments"
CREATE INDEX "ama_question_tag_assignments_ama_id_idx" ON "ama_question_tag_assignments" ("ama_id");
