-- Create "automoderator_guild_settings" table
CREATE TABLE "automoderator_guild_settings" (
  "guild_id" text NOT NULL,
  "dry_run" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("guild_id")
);
