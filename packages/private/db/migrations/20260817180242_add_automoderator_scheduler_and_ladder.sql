-- Create enum type "automoderator_warn_punishment_action"
CREATE TYPE "automoderator_warn_punishment_action" AS ENUM ('MUTE', 'KICK', 'BAN');
-- Modify "automoderator_cases" table
ALTER TABLE "automoderator_cases" ADD COLUMN "lifted_at" timestamptz NULL;
-- Create index "automoderator_cases_pending_auto_pardon_idx" to table: "automoderator_cases"
CREATE INDEX "automoderator_cases_pending_auto_pardon_idx" ON "automoderator_cases" ("created_at") WHERE ((action_type = 'WARN'::automoderator_case_action) AND (pardoned_by IS NULL));
-- Create index "automoderator_cases_pending_expiry_idx" to table: "automoderator_cases"
CREATE INDEX "automoderator_cases_pending_expiry_idx" ON "automoderator_cases" ("expires_at") WHERE ((action_type = 'BAN'::automoderator_case_action) AND (expires_at IS NOT NULL) AND (lifted_at IS NULL));
-- Modify "automoderator_guild_settings" table
ALTER TABLE "automoderator_guild_settings" ADD COLUMN "auto_pardon_warns_after" integer NULL;
-- Create "automoderator_warn_punishments" table
CREATE TABLE "automoderator_warn_punishments" (
  "guild_id" text NOT NULL,
  "warns" integer NOT NULL,
  "action_type" "automoderator_warn_punishment_action" NOT NULL,
  "duration_seconds" integer NULL,
  PRIMARY KEY ("guild_id", "warns"),
  CONSTRAINT "automoderator_warn_punishments_duration_check" CHECK (
CASE action_type
    WHEN 'KICK'::automoderator_warn_punishment_action THEN (duration_seconds IS NULL)
    WHEN 'MUTE'::automoderator_warn_punishment_action THEN (duration_seconds >= 1)
    ELSE ((duration_seconds IS NULL) OR (duration_seconds >= 1))
END),
  CONSTRAINT "automoderator_warn_punishments_warns_check" CHECK (warns >= 1)
);
