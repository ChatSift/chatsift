export async function up(sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS filter_triggers (
      guild_id bigint NOT NULL,
      user_id bigint NOT NULL,
      count int NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION next_punishment(bigint, bigint) RETURNS int
    LANGUAGE plpgsql
    stable
    AS $$
    DECLARE next_punishment int;
    BEGIN
      SELECT count INTO next_punishment FROM filter_triggers WHERE guild_id = $1 AND user_id = $2;
      if next_punishment IS NULL THEN return 1; end if;
      return next_punishment + 1;
    END;
    $$;
  `);
}

export async function down(sql) {
  await sql.unsafe('DROP TABLE IF EXISTS filter_triggers');
  await sql.unsafe('DROP FUNCTION IF EXISTS next_punishment(bigint, bigint)');
}
