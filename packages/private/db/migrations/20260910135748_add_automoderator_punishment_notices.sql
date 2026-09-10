-- Create enum type "automoderator_notice_scope"
CREATE TYPE "automoderator_notice_scope" AS ENUM ('DEFAULT', 'WARN', 'MUTE', 'KICK', 'SOFTBAN', 'BAN');
-- Create "automoderator_punishment_notices" table
CREATE TABLE "automoderator_punishment_notices" (
  "guild_id" text NOT NULL,
  "scope" "automoderator_notice_scope" NOT NULL,
  "content" text NOT NULL,
  PRIMARY KEY ("guild_id", "scope"),
  CONSTRAINT "automoderator_punishment_notices_content_check" CHECK ((btrim(content) <> ''::text) AND (length(content) <= 2000))
);
