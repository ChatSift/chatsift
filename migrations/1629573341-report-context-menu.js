export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS reports_channel bigint');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS reports_channel');
}
