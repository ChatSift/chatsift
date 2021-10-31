export async function up(sql) {
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS hentai_threshold decimal`);
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS porn_threshold decimal`);
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS sexy_threshold decimal`);
}

export async function down(sql) {
  await sql.unsafe(`ALTER TABLE guild_settings DROP COLUMN IF EXISTS hentai_threshold decimal`);
  await sql.unsafe(`ALTER TABLE guild_settings DROP COLUMN IF EXISTS porn_threshold decimal`);
  await sql.unsafe(`ALTER TABLE guild_settings DROP COLUMN IF EXISTS sexy_threshold decimal`);
}
