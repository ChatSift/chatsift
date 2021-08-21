export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS user_update_log_channel bigint');
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS message_update_log_channel bigint');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS user_update_log_channel');
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS message_update_log_channel');
}
