-- Create "automoderator_log_exemptions" table
CREATE TABLE "automoderator_log_exemptions" (
  "guild_id" text NOT NULL,
  "channel_id" text NOT NULL,
  PRIMARY KEY ("guild_id", "channel_id")
);
