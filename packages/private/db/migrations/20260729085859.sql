-- Create "modmail_instances" table
CREATE TABLE "modmail_instances" (
  "id" text NOT NULL,
  "guild_id" text NOT NULL,
  "token" text NOT NULL,
  "label" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "modmail_instances_guild_id_key" UNIQUE ("guild_id")
);
