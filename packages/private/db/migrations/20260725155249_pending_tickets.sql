-- Create "pending_tickets" table
CREATE TABLE "pending_tickets" (
  "private_thread_id" text NOT NULL,
  "guild_id" text NOT NULL,
  "user_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("private_thread_id")
);
