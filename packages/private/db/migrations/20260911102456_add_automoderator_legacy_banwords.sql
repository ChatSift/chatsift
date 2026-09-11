-- Create "automoderator_legacy_banwords" table
CREATE TABLE "automoderator_legacy_banwords" (
  "guild_id" text NOT NULL,
  "word" text NOT NULL,
  "flags" text[] NOT NULL,
  "duration_seconds" integer NULL,
  PRIMARY KEY ("guild_id", "word")
);
