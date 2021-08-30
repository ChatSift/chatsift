export async function up(sql) {
  await sql.unsafe('ALTER TABLE self_assignable_roles_prompts ALTER COLUMN embed_description DROP NOT NULL');
  await sql.unsafe('ALTER TABLE self_assignable_roles_prompts ADD COLUMN IF NOT EXISTS embed_image text');
}
