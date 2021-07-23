export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN admin_role bigint');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN admin_role');
}
