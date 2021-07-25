export async function up(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS allowed_invites (
      guild_id bigint NOT NULL,
      invite_code text NOT NULL,
      PRIMARY KEY (guild_id, invite_code)
    );
  `);
}

export async function down(sql) {
  await sql.unsafe('DROP TABLE allowed_invites');
}
