-- Modify "categories" table
ALTER TABLE "categories" ADD CONSTRAINT "categories_max_concurrent_threads_check" CHECK ((max_concurrent_threads IS NULL) OR (max_concurrent_threads >= 1)), ADD COLUMN "max_concurrent_threads" integer NULL;
-- Modify "guild_settings" table
ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_max_concurrent_threads_check" CHECK (max_concurrent_threads >= 1), ADD COLUMN "max_concurrent_threads" integer NOT NULL DEFAULT 1;
