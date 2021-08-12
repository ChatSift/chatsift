import type { GuildSettings } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class SettingsController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(guildId: Snowflake): Promise<GuildSettings | undefined> {
    return this
      .sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${guildId}`
      .then(rows => rows[0]);
  }

  public update(guildId: Snowflake, data: Partial<Omit<GuildSettings, 'guild_id'>>): Promise<GuildSettings> {
    const sql = { guild_id: guildId, ...data };
    return this
      .sql<[GuildSettings]>`
        INSERT INTO guild_settings ${this.sql(sql)}
        ON CONFLICT (guild_id)
        DO UPDATE SET ${this.sql(sql)}
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public delete(guildId: Snowflake): Promise<GuildSettings | undefined> {
    return this
      .sql<[GuildSettings?]>`
        DELETE FROM guild_settings
        WHERE guild_id = ${guildId}
        RETURNING *
      `
      .then(rows => rows[0]);
  }
}
