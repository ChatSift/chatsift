export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN filter_trigger_log_channel bigint');
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS webhook_tokens (
      channel_id bigint PRIMARY KEY,
      webhook_id bigint NOT NULL,
      webhook_token text NOT NULL
    )
  `);
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN filter_trigger_log_channel');
  await sql.unsafe('DROP TABLE webhook_tokens');
}
