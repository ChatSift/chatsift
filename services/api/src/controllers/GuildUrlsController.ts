import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { LocalMaliciousUrl, MaliciousUrl } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';

@singleton()
export class GuildUrlsController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(page: number, guildId: Snowflake): Promise<LocalMaliciousUrl[]> {
    return this.sql`
      SELECT * FROM malicious_urls
      WHERE guild_id = ${guildId}
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(guildId: Snowflake): Promise<LocalMaliciousUrl[]> {
    return this.sql`SELECT * FROM malicious_urls WHERE guild_id = ${guildId}`;
  }

  public getHitsFrom(urls: string[], guildId: Snowflake, guildOnly: true): Promise<LocalMaliciousUrl[]>;
  public getHitsFrom(urls: string[], guildId: Snowflake, guildOnly?: false): Promise<MaliciousUrl[]>;
  public getHitsFrom(urls: string[], guildId: Snowflake, guildOnly: boolean): Promise<MaliciousUrl[]>;
  public getHitsFrom(urls: string[], guildId: Snowflake, guildOnly = false): Promise<MaliciousUrl[]> {
    if (guildOnly) {
      return this.sql<LocalMaliciousUrl[]>`
        SELECT *
        FROM malicious_urls
        WHERE url = ANY(${this.sql.array(urls)}) AND guild_id = ${guildId}
      `;
    }

    return this.sql<MaliciousUrl[]>`
      SELECT *
      FROM malicious_urls
      WHERE url = ANY(${this.sql.array(urls)}) AND (guild_id = ${guildId} OR guild_id IS NULL)
    `;
  }

  public add(urls: string[], guildId: Snowflake) {
    return this.sql.begin(sql => {
      const promises: Promise<LocalMaliciousUrl>[] = [];

      for (const url of urls) {
        const promise = sql<[LocalMaliciousUrl]>`
          INSERT INTO malicious_urls (url, guild_id)
          VALUES (${url}, ${guildId})
          ON CONFLICT (url)
          DO
            UPDATE SET last_modified_at = NOW()
            RETURNING *
        `.then(rows => rows[0]);

        promises.push(promise);
      }

      return Promise.all(promises);
    });
  }

  public delete(urls: string[], guildId: Snowflake) {
    return this.sql<LocalMaliciousUrl[]>`
      DELETE FROM malicious_urls
      WHERE url = ANY(${this.sql.array(urls)})
        AND guild_id = ${guildId}
      RETURNING *
    `;
  }
}
