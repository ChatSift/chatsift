-- Create index "categories_guild_id_forum_tag_id_key" to table: "categories"
CREATE UNIQUE INDEX "categories_guild_id_forum_tag_id_key" ON "categories" ("guild_id", "forum_tag_id") WHERE (forum_tag_id IS NOT NULL);
