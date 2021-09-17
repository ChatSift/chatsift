export async function up(sql) {
  await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS automod_triggers (
			guild_id bigint NOT NULL,
			user_id bigint NOT NULL,
			count int NOT NULL,
			created_at timestamptz NOT NULL DEFAULT NOW(),
			PRIMARY KEY (guild_id, user_id)
		)
	`);

  await sql.unsafe(`
		CREATE OR REPLACE FUNCTION next_automod_trigger(bigint, bigint) RETURNS int
		LANGUAGE plpgsql
		stable
		AS $$
		DECLARE next_automod_trigger int;
		BEGIN
			SELECT count INTO next_automod_trigger FROM automod_triggers WHERE guild_id = $1 AND user_id = $2;
			if next_automod_trigger IS NULL THEN RETURN 1; end if;
			return next_automod_trigger + 1;
		end;
		$$;
	`);

  await sql.unsafe(`
		CREATE OR REPLACE FUNCTION previous_automod_trigger(bigint, bigint) RETURNS int
		LANGUAGE plpgsql
		stable
		AS $$
		DECLARE previous_automod_trigger int;
		BEGIN
			SELECT count INTO previous_automod_trigger FROM automod_triggers WHERE guild_id = $1 AND user_id = $2;
			if previous_automod_trigger IS NULL THEN RETURN 0; end if;
			return previous_automod_trigger - 1;
		end;
		$$;
	`);
}
