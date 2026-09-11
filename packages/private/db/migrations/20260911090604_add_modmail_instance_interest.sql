-- Create "modmail_instance_interest" table
CREATE TABLE "modmail_instance_interest" (
  "guild_id" text NOT NULL,
  "user_id" text NOT NULL,
  "guild_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("guild_id")
);
