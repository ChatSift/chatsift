-- Modify "pending_tickets" table
ALTER TABLE "pending_tickets" ADD COLUMN "category_id" integer NULL, ADD CONSTRAINT "pending_tickets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
-- Create index "pending_tickets_guild_id_user_id_category_id_idx" to table: "pending_tickets"
CREATE INDEX "pending_tickets_guild_id_user_id_category_id_idx" ON "pending_tickets" ("guild_id", "user_id", "category_id");
