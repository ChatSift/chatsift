import type { LogIgnore } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class LogIgnoresController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(guildId: Snowflake): Promise<LogIgnore[]> {
    return this.sql<LogIgnore[]>`SELECT * FROM log_ignores WHERE guild_id = ${guildId}`;
  }

  public add(guildId: Snowflake, channelId: Snowflake): Promise<LogIgnore | undefined> {
    return this
      .sql<[LogIgnore?]>`
        INSERT INTO log_ignores (guild_id, channel_id)
        VALUES (${guildId}, ${channelId})
        ON CONFLICT DO NOTHING
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public remove(channelId: Snowflake): Promise<LogIgnore | undefined> {
    return this
      .sql<[LogIgnore?]>`DELETE FROM log_ignores WHERE channel_id = ${channelId} RETURNING *`
      .then(rows => rows[0]);
  }

  public removeAll(guildId: Snowflake): Promise<LogIgnore[]> {
    return this.sql<LogIgnore[]>`
      DELETE FROM log_ignores
      WHERE guild_id = ${guildId}
      RETURNING *
    `;
  }
}

