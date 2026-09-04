-- Modify "automoderator_guild_settings" table
ALTER TABLE "automoderator_guild_settings" ADD CONSTRAINT "automoderator_guild_settings_min_join_age_check" CHECK ((min_join_age_seconds IS NULL) OR (min_join_age_seconds >= 1)), ADD COLUMN "min_join_age_seconds" integer NULL;
