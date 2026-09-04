-- Modify "ama_sessions" table
ALTER TABLE "ama_sessions" ADD CONSTRAINT "ama_sessions_max_questions_per_user_check" CHECK ((max_questions_per_user IS NULL) OR (max_questions_per_user >= 1)), ADD COLUMN "max_questions_per_user" integer NULL;
