export async function up(sql) {
  await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS log_ignores (
			channel_id bigint PRIMARY KEY,
			guild_id bigint NOT NULL
		)
	`);
}

export async function down(sql) {
  await sql.unsafe('DROP TABLE IF EXISTS log_ignores');
}
