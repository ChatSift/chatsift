export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS no_blank_avatar boolean NOT NULL DEFAULT false');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS no_blank_avatar');
}
