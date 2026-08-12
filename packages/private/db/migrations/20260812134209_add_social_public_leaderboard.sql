-- Modify "social_guild_settings" table
ALTER TABLE "social_guild_settings" ADD COLUMN "public_leaderboard" boolean NOT NULL DEFAULT false;
-- Create index "social_users_guild_id_xp_idx" to table: "social_users"
CREATE INDEX "social_users_guild_id_xp_idx" ON "social_users" ("guild_id", "xp" DESC);
