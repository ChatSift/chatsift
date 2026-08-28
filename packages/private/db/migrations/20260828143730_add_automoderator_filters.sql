-- Create enum type "automoderator_filter_kind"
CREATE TYPE "automoderator_filter_kind" AS ENUM ('URLS', 'INVITES', 'ANTISPAM');
-- Modify "automoderator_guild_settings" table
ALTER TABLE "automoderator_guild_settings" ADD COLUMN "use_url_filters" boolean NOT NULL DEFAULT false, ADD COLUMN "use_invite_filters" boolean NOT NULL DEFAULT false;
-- Create "automoderator_allowed_invites" table
CREATE TABLE "automoderator_allowed_invites" (
  "guild_id" text NOT NULL,
  "allowed_guild_id" text NOT NULL,
  PRIMARY KEY ("guild_id", "allowed_guild_id")
);
-- Create "automoderator_allowed_urls" table
CREATE TABLE "automoderator_allowed_urls" (
  "guild_id" text NOT NULL,
  "domain" text NOT NULL,
  PRIMARY KEY ("guild_id", "domain")
);
-- Create "automoderator_filter_exemptions" table
CREATE TABLE "automoderator_filter_exemptions" (
  "guild_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "filter" "automoderator_filter_kind" NOT NULL,
  PRIMARY KEY ("guild_id", "channel_id", "filter")
);
-- Create index "automoderator_filter_exemptions_guild_id_filter_idx" to table: "automoderator_filter_exemptions"
CREATE INDEX "automoderator_filter_exemptions_guild_id_filter_idx" ON "automoderator_filter_exemptions" ("guild_id", "filter");
