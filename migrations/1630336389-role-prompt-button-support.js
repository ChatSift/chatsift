export async function up(sql) {
  await sql.unsafe('ALTER TABLE self_assignable_roles_prompts ADD COLUMN IF NOT EXISTS use_buttons boolean NOT NULL DEFAULT false');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE self_assignable_roles_prompts DROP COLUMN IF EXISTS use_buttons');
}
