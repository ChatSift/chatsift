-- Create enum type "automoderator_trigger_punishment_action"
CREATE TYPE "automoderator_trigger_punishment_action" AS ENUM ('WARN', 'MUTE', 'KICK', 'BAN');
-- Modify "automoderator_banword_policies" table
ALTER TABLE "automoderator_banword_policies" DROP CONSTRAINT "automoderator_banword_policies_duration_check", ADD CONSTRAINT "automoderator_banword_policies_duration_check" CHECK (
CASE action_type
    WHEN 'MUTE'::automoderator_banword_action THEN ((duration_seconds IS NOT NULL) AND (duration_seconds >= 1))
    WHEN 'BAN'::automoderator_banword_action THEN ((duration_seconds IS NULL) OR (duration_seconds >= 1))
    ELSE (duration_seconds IS NULL)
END);
-- Modify "automoderator_guild_settings" table
ALTER TABLE "automoderator_guild_settings" ADD CONSTRAINT "automoderator_guild_settings_antispam_check" CHECK (((antispam_amount IS NULL) = (antispam_time IS NULL)) AND ((antispam_amount IS NULL) OR ((antispam_amount >= 2) AND (antispam_time >= 1)))), ADD CONSTRAINT "automoderator_guild_settings_trigger_decay_check" CHECK ((trigger_decay_minutes IS NULL) OR (trigger_decay_minutes >= 1)), ADD COLUMN "antispam_amount" integer NULL, ADD COLUMN "antispam_time" integer NULL, ADD COLUMN "trigger_decay_minutes" integer NULL;
-- Modify "automoderator_warn_punishments" table
ALTER TABLE "automoderator_warn_punishments" DROP CONSTRAINT "automoderator_warn_punishments_duration_check", ADD CONSTRAINT "automoderator_warn_punishments_duration_check" CHECK (
CASE action_type
    WHEN 'KICK'::automoderator_warn_punishment_action THEN (duration_seconds IS NULL)
    WHEN 'MUTE'::automoderator_warn_punishment_action THEN ((duration_seconds IS NOT NULL) AND (duration_seconds >= 1))
    ELSE ((duration_seconds IS NULL) OR (duration_seconds >= 1))
END);
-- Create "automoderator_trigger_counts" table
CREATE TABLE "automoderator_trigger_counts" (
  "guild_id" text NOT NULL,
  "user_id" text NOT NULL,
  "count" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("guild_id", "user_id"),
  CONSTRAINT "automoderator_trigger_counts_count_check" CHECK (count >= 1)
);
-- Create index "automoderator_trigger_counts_updated_at_idx" to table: "automoderator_trigger_counts"
CREATE INDEX "automoderator_trigger_counts_updated_at_idx" ON "automoderator_trigger_counts" ("updated_at");
-- Create "automoderator_trigger_punishments" table
CREATE TABLE "automoderator_trigger_punishments" (
  "guild_id" text NOT NULL,
  "triggers" integer NOT NULL,
  "action_type" "automoderator_trigger_punishment_action" NOT NULL,
  "duration_seconds" integer NULL,
  PRIMARY KEY ("guild_id", "triggers"),
  CONSTRAINT "automoderator_trigger_punishments_duration_check" CHECK (
CASE action_type
    WHEN 'WARN'::automoderator_trigger_punishment_action THEN (duration_seconds IS NULL)
    WHEN 'KICK'::automoderator_trigger_punishment_action THEN (duration_seconds IS NULL)
    WHEN 'MUTE'::automoderator_trigger_punishment_action THEN ((duration_seconds IS NOT NULL) AND (duration_seconds >= 1))
    ELSE ((duration_seconds IS NULL) OR (duration_seconds >= 1))
END),
  CONSTRAINT "automoderator_trigger_punishments_triggers_check" CHECK (triggers >= 1)
);
