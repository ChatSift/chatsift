import { Rest } from '@cordis/rest';
import config from '../ley.config.mjs';

export async function up(sql) {
	const rest = new Rest(config.discordAuth);

	const data = await sql.unsafe(`SELECT * FROM allowed_invites`);
	const guilds = [];

	await sql.unsafe(`DROP TABLE allowed_invites`);
	await sql.unsafe(`
    CREATE TABLE allowed_invites (
      guild_id bigint NOT NULL,
      allowed_guild_id bigint NOT NULL,
      PRIMARY KEY (guild_id, allowed_guild_id)
    )
  `);

	for (const { guild_id, invite_code } of data) {
		guilds.push(
			rest
				.get(`/invites/${invite_code}`)
				.then((invite) => [guild_id, invite.guild.id])
				.catch(() => [null, null]),
		);
	}

	for (const [guildId, allowedGuild] of await Promise.all(guilds)) {
		if (guildId && allowedGuild) {
			await sql.unsafe(`
        INSERT INTO allowed_invites (guild_id, allowed_guild_id)
        VALUES (${guildId}, ${allowedGuild})
        ON CONFLICT DO NOTHING
      `);
		}
	}
}

export async function down(sql) {
	await sql.unsafe(`DROP TABLE allowed_invites`);
	await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS allowed_invites (
      guild_id bigint NOT NULL,
      invite_code bigint NOT NULL,
      PRIMARY KEY (guild_id, invite_code)
    )
  `);
}
