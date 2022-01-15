export async function up(sql) {
	await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS hentai_threshold int`);
	await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS porn_threshold int`);
	await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS sexy_threshold int`);
}

export async function down(sql) {
	await sql.unsafe(`ALTER TABLE guild_settings DROP COLUMN IF EXISTS hentai_threshold`);
	await sql.unsafe(`ALTER TABLE guild_settings DROP COLUMN IF EXISTS porn_threshold`);
	await sql.unsafe(`ALTER TABLE guild_settings DROP COLUMN IF EXISTS sexy_threshold`);
}
