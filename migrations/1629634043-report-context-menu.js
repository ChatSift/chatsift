export async function up(sql) {
  await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS reported_messages (
			message_id bigint PRIMARY KEY,
			report_message_id bigint,
			ack boolean DEFAULT false NOT NULL
		)
	`);
  await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS message_reporters (
			message_id bigint NOT NULL REFERENCES reported_messages ON DELETE CASCADE,
			original boolean DEFAULT false NOT NULL,
			reporter_id bigint NOT NULL,
			reporter_tag text NOT NULL,
			PRIMARY KEY (message_id, reporter_id)
		)
	`);
}

export async function down(sql) {
  await sql.unsafe('DROP TABLE message_reporters');
  await sql.unsafe('DROP TABLE reported_messages');
}
