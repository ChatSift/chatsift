export async function up(sql) {
  await sql.unsafe('DELETE FROM guild_settings');
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS message_id bigint NOT NULL');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS message_id');
}
