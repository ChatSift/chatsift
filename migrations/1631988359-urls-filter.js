export async function up(sql) {
  await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS allowed_urls (
			guild_id bigint NOT NULL,
			domain text NOT NULL,
			PRIMARY KEY (guild_id, domain)
		)
  `);
}

export async function down(sql) {
  await sql.unsafe(`DROP TABLE IF EXISTS allowed_urls`);
}
