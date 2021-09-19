import type { AllowedUrl } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class UrlsAllowlistController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(guildId: Snowflake, domain: string): Promise<AllowedUrl | undefined> {
    return this
      .sql<[AllowedUrl?]>`SELECT * FROM allowed_urls WHERE guild_id = ${guildId} AND domain = ${domain}`
      .then(rows => rows[0]);
  }

  public getAll(guildId: Snowflake): Promise<AllowedUrl[]> {
    return this.sql<AllowedUrl[]>`SELECT * FROM allowed_urls WHERE guild_id = ${guildId}`;
  }

  public async add(guildId: Snowflake, domain: string): Promise<AllowedUrl | undefined> {
    if (await this.get(guildId, domain)) {
      return;
    }

    return this
      .sql<[AllowedUrl]>`INSERT INTO allowed_urls (guild_id, domain) VALUES (${guildId}, ${domain}) RETURNING *`
      .then(rows => rows[0]);
  }

  public delete(guildId: Snowflake, domain: string): Promise<AllowedUrl | undefined> {
    return this
      .sql<AllowedUrl[]>`
        DELETE FROM allowed_urls
        WHERE guild_id = ${guildId} AND domain = ${domain}
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public deleteAll(guildId: Snowflake): Promise<AllowedUrl[]> {
    return this.sql<AllowedUrl[]>`
      DELETE FROM allowed_urls
      WHERE guild_id = ${guildId}
      RETURNING *
    `;
  }
}
