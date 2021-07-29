import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { GuildSettings } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';

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
    return this
      .sql<[GuildSettings]>`
        INSERT INTO guild_settings ${this.sql(data)}
        ON CONFLICT (guild_id)
        DO UPDATE SET ${this.sql(data)}
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
