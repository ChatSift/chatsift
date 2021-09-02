export async function up(sql) {
  await sql.unsafe('ALTER TABLE malicious_files DROP COLUMN IF EXISTS admin_id');
  await sql.unsafe('ALTER TABLE malicious_urls DROP COLUMN IF EXISTS admin_id');
}
