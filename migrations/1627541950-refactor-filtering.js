export async function up(sql) {
  await sql.unsafe('DELETE FROM malicious_files WHERE guild_id is NOT NULL');
  await sql.unsafe('ALTER TABLE malicious_files DROP COLUMN guild_id');
  await sql.unsafe('ALTER TABLE malicious_files ALTER COLUMN admin_id SET NOT NULL');
  await sql.unsafe('ALTER TABLE malicious_files ALTER COLUMN category SET NOT NULL');

  await sql.unsafe('DELETE FROM malicious_urls WHERE guild_id is NOT NULL');
  await sql.unsafe('ALTER TABLE malicious_urls DROP COLUMN guild_id');
  await sql.unsafe('ALTER TABLE malicious_urls ALTER COLUMN admin_id SET NOT NULL');
  await sql.unsafe('ALTER TABLE malicious_urls ALTER COLUMN category SET NOT NULL');
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE malicious_files ADD COLUMN guild_id bigint');
  await sql.unsafe('ALTER TABLE malicious_files ALTER COLUMN admin_id DROP NOT NULL');
  await sql.unsafe('ALTER TABLE malicious_files ALTER COLUMN category DROP NOT NULL');

  await sql.unsafe('ALTER TABLE malicious_urls ADD COLUMN guild_id bigint');
  await sql.unsafe('ALTER TABLE malicious_urls ALTER COLUMN admin_id DROP NOT NULL');
  await sql.unsafe('ALTER TABLE malicious_urls ALTER COLUMN category DROP NOT NULL');
}
