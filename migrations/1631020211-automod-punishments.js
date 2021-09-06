export async function up(sql) {
  await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS automod_punishments (
			guild_id bigint NOT NULL,
			triggers int NOT NULL,
			action_type int NOT NULL,
			duration int,
			PRIMARY KEY (guild_id, triggers)
		)
	`);

  await sql.unsafe(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS automod_cooldown int`);
}
