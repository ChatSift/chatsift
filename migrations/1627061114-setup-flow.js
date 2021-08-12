export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS admin_role bigint');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS admin_role');
}
