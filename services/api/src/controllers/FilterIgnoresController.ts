import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { FilterIgnore } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';

@singleton()
export class FilterIgnoresController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(channelId: Snowflake): Promise<FilterIgnore | undefined> {
    return this
      .sql<[FilterIgnore?]>`SELECT * FROM filter_ignores WHERE channel_id = ${channelId}`
      .then(rows => rows[0]);
  }

  public getAll(guildId: Snowflake): Promise<FilterIgnore[]> {
    return this.sql<FilterIgnore[]>`SELECT * FROM filter_ignores WHERE guild_id = ${guildId}`;
  }

  public update(ignore: FilterIgnore) {
    return this.sql<[FilterIgnore]>`
      INSERT INTO filter_ignores ${this.sql(ignore)}
      ON CONFLICT (channel_id)
      DO UPDATE SET ${this.sql(ignore)}
      RETURNING *
    `;
  }

  public delete(channelId: Snowflake): Promise<FilterIgnore | undefined> {
    return this
      .sql<[FilterIgnore?]>`DELETE FROM filter_ignores WHERE channel_id = ${channelId} RETURNING *`
      .then(rows => rows[0]);
  }

  public deleteAll(guildId: Snowflake): Promise<FilterIgnore[]> {
    return this.sql<FilterIgnore[]>`
      DELETE FROM filter_ignores
      WHERE guild_id = ${guildId}
      RETURNING *
    `;
  }
}
