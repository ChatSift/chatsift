export async function up(sql) {
	await sql.unsafe(`ALTER TABLE self_assignable_roles ADD COLUMN IF NOT EXISTS emoji_id bigint`);
	await sql.unsafe(`ALTER TABLE self_assignable_roles ADD COLUMN IF NOT EXISTS emoji_name text`);
	await sql.unsafe(`ALTER TABLE self_assignable_roles ADD COLUMN IF NOT EXISTS emoji_animated boolean`);
}

export async function down(sql) {
	await sql.unsafe(`ALTER TABLE self_assignable_roles DROP COLUMN IF EXISTS emoji_id`);
	await sql.unsafe(`ALTER TABLE self_assignable_roles DROP COLUMN IF EXISTS emoji_name`);
	await sql.unsafe(`ALTER TABLE self_assignable_roles DROP COLUMN IF EXISTS emoji_animated`);
}
