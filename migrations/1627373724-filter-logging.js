export async function up(sql) {
  await sql.unsafe(`
    CREATE TABLE banned_words (
      guild_id bigint NOT NULL,
      word text NOT NULL,
      flags bigint NOT NULL,
      duration int,
      PRIMARY KEY (guild_id, word)
    )
  `);
}

export async function down(sql) {
  await sql.unsafe('DROP TABLE banned_words');
}
