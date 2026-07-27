-- Modify "guild_settings" table
ALTER TABLE "guild_settings" DROP CONSTRAINT "guild_settings_nuke_delay_minutes_check", ADD CONSTRAINT "guild_settings_nuke_delay_minutes_check" CHECK ((nuke_delay_minutes IS NULL) OR (nuke_delay_minutes >= 1)), ALTER COLUMN "nuke_delay_minutes" DROP NOT NULL, ALTER COLUMN "nuke_delay_minutes" DROP DEFAULT;
