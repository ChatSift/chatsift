export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN use_invite_filters boolean NOT NULL DEFAULT false');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN use_invite');
}
