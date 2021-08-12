import type { BannedWord } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class LocalFiltersController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(guildId: Snowflake, page: number): Promise<BannedWord[]> {
    return this.sql`
      SELECT * FROM banned_words
      WHERE guild_id = ${guildId}
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(guildId: Snowflake): Promise<BannedWord[]> {
    return this.sql<BannedWord[]>`SELECT * FROM banned_words WHERE guild_id = ${guildId}`;
  }

  public update(guildId: Snowflake, data: Omit<BannedWord, 'guild_id'>): Promise<BannedWord> {
    return this
      .sql<[BannedWord]>`
        INSERT INTO banned_words ${this.sql(data)}
        ON CONFLICT (guild_id, word)
        DO UPDATE SET ${this.sql(data)}
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public delete(guildId: Snowflake, word: string): Promise<BannedWord | undefined> {
    return this
      .sql<[BannedWord]>`
        DELETE FROM banned_words
        WHERE guild_id = ${guildId}
          AND word = ${word}
      `
      .then(rows => rows[0]);
  }

  public deleteAll(guildId: Snowflake): Promise<BannedWord[]> {
    return this.sql<BannedWord[]>`DELETE FROM banned_words WHERE guild_id = ${guildId}`;
  }
}
