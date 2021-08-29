export async function up(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS self_assignable_roles_prompts (
      prompt_id serial PRIMARY KEY,
      embed_title text NOT NULL,
      embed_description text NOT NULL,
      embed_color int NOT NULL,
      guild_id bigint NOT NULL,
      channel_id bigint NOT NULL,
      message_id bigint NOT NULL
    )
  `);

  await sql.unsafe('DELETE FROM self_assignable_roles');
  await sql.unsafe(`
    ALTER TABLE self_assignable_roles
      ADD COLUMN IF NOT EXISTS
        prompt_id int NOT NULL REFERENCES self_assignable_roles_prompts ON DELETE CASCADE
  `);

  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN IF EXISTS assignable_roles_prompt');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE self_assignable_roles DROP COLUMN IF EXISTS prompt_id');
  await sql.unsafe('DROP TABLE IF EXISTS self_assignable_roles_prompts');
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS assignable_roles_prompt text');
}
