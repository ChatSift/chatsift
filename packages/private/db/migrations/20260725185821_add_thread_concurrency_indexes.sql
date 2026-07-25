-- Create index "pending_tickets_guild_id_user_id_idx" to table: "pending_tickets"
CREATE INDEX "pending_tickets_guild_id_user_id_idx" ON "pending_tickets" ("guild_id", "user_id");
-- Create index "threads_guild_id_user_id_category_id_open_idx" to table: "threads"
CREATE INDEX "threads_guild_id_user_id_category_id_open_idx" ON "threads" ("guild_id", "user_id", "category_id") WHERE (closed_at IS NULL);
-- Create index "threads_guild_id_user_id_open_idx" to table: "threads"
CREATE INDEX "threads_guild_id_user_id_open_idx" ON "threads" ("guild_id", "user_id") WHERE (closed_at IS NULL);
