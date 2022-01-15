export async function up(sql) {
	const roles = await sql.unsafe('SELECT * FROM self_assignable_roles');

	await sql.unsafe('DELETE FROM self_assignable_roles');
	await sql.unsafe('ALTER TABLE self_assignable_roles ADD COLUMN IF NOT EXISTS id serial NOT NULL');

	let id = 1;

	for (const role of roles) {
		await sql`
      INSERT INTO self_assignable_roles (
        id,
        role_id,
        prompt_id,
        guild_id,
        emoji_id,
        emoji_name,
        emoji_animated
      ) VALUES (
        ${id++},
        ${role.role_id},
        ${role.prompt_id},
        ${role.guild_id},
        ${role.emoji_id},
        ${role.emoji_name},
        ${role.emoji_animated}
      );
    `;
	}
}

export async function down(sql) {
	await sql.unsafe(`ALTER TABLE self_assignable_roles DROP COLUMN IF EXISTS id`);
}
