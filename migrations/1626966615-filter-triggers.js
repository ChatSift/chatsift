export async function up(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS filter_triggers (
      guild_id bigint NOT NULL,
      user_id bigint NOT NULL,
      count int NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
}

export async function down(sql) {
  await sql.unsafe('DROP TABLE filter_triggers');
}
