-- Modify "guild_settings" table
ALTER TABLE "guild_settings" ADD COLUMN "greeting_before_opener" boolean NOT NULL DEFAULT false;
