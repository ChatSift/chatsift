export async function up(sql) {
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS antispam_amount int`);
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS antispam_time int`);
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS mention_limit int`);
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS mention_amount int`);
  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS mention_time int`);
}
