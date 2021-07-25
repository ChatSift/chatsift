export async function up(sql) {
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN use_invite_filters boolean NOT NULL DEFAULT false');

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS filter_ignores (
      channel_id bigint NOT NULL PRIMARY KEY,
      guild_id bigint NOT NULL,
      value bigint NOT NULL
    )
  `);
}

export async function down(sql) {
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN use_invite_filters');
  await sql.unsafe('DROP TABLE filter_ignores');
}
