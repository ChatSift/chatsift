-- Modify "threads" table
ALTER TABLE "threads" ADD COLUMN "migration_source" text NULL;
-- Create index "threads_migration_source_idx" to table: "threads"
CREATE INDEX "threads_migration_source_idx" ON "threads" ("migration_source") WHERE (migration_source IS NOT NULL);
