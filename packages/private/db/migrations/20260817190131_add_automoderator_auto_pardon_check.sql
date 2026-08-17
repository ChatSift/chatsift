-- Modify "automoderator_guild_settings" table
ALTER TABLE "automoderator_guild_settings" ADD CONSTRAINT "automoderator_guild_settings_auto_pardon_check" CHECK ((auto_pardon_warns_after IS NULL) OR (auto_pardon_warns_after >= 1));
