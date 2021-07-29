export async function up(sql) {
  const settings = await sql.unsafe('SELECT * FROM guild_settings');
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN use_url_filters');
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN use_url_filters boolean NOT NULL DEFAULT false');

  for (const setting of settings) {
    await sql.unsafe(`
      UPDATE guild_settings
      SET use_url_filters = ${setting.use_url_filters === 0 ? false : true}
      WHERE guild_id = ${setting.guild_id}
    `);
  }
}

export async function down(sql) {
  const settings = await sql.unsafe('SELECT * FROM guild_settings');
  await sql.unsafe('ALTER TABLE guild_settings DROP COLUMN use_url_filters');
  await sql.unsafe('ALTER TABLE guild_settings ADD COLUMN use_url_filters int NOT NULL DEFAULT 1');

  for (const setting of settings) {
    await sql.unsafe(`
      UPDATE guild_settings
      SET use_url_filters = ${settings.use_url_filters ? 2 : 0}
      WHERE guild_id = ${setting.guild_id}
    `);
  }
}
