export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS min_join_age int');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS min_join_age');
}
