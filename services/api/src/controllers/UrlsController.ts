import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { GlobalMaliciousUrl, MaliciousUrlCategory } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v8';

interface Ok<T> {
  success: true;
  value: T;
}

interface NotOk {
  success: false;
  error: string;
}

type Result<T> = Ok<T> | NotOk;

@singleton()
export class UrlsController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(page: number): Promise<GlobalMaliciousUrl[]> {
    return this.sql`
      SELECT * FROM malicious_urls
      WHERE guild_id IS NULL
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(): Promise<GlobalMaliciousUrl[]> {
    return this.sql`SELECT * FROM malicious_urls WHERE guild_id IS NULL`;
  }

  public getHitsFrom(urls: string[]): Promise<GlobalMaliciousUrl[]> {
    return this.sql<GlobalMaliciousUrl[]>`
      SELECT *
      FROM malicious_urls
      WHERE url = ANY(${this.sql.array(urls)}) AND guild_id IS NULL
    `;
  }

  public async updateBulk(urls: { url_id: number; category: MaliciousUrlCategory }[]): Promise<Result<GlobalMaliciousUrl[]>> {
    const data = await this.sql
      .begin(async sql => {
        const updated: GlobalMaliciousUrl[] = [];

        for (const url of urls) {
          const [data] = await sql<[GlobalMaliciousUrl?]>`
            UPDATE malicious_urls
            SET category = ${url.category}, last_modified_at = NOW()
            WHERE url_id = ${url.url_id}
              AND guild_id IS NULL
            RETURNING *
          `;

          if (!data) {
            return Promise.reject(`nothing to update for url ${url.url_id}`);
          }

          updated.push(data);
        }

        return updated;
      })
      .catch((e: string) => e);

    return Array.isArray(data)
      ? { success: true, value: data }
      : { success: false, error: data };
  }

  public add(urls: { url: string; admin: Snowflake; category: MaliciousUrlCategory }[]) {
    return this.sql.begin(sql => {
      const promises: Promise<GlobalMaliciousUrl>[] = [];

      for (const data of urls) {
        const promise = sql<[GlobalMaliciousUrl]>`
          INSERT INTO malicious_urls (url, admin_id, category)
          VALUES (${data.url}, ${data.admin}, ${data.category})
          ON CONFLICT (url)
          DO
            UPDATE SET category = ${data.category}, last_modified_at = NOW()
            RETURNING *
        `.then(rows => rows[0]);

        promises.push(promise);
      }

      return Promise.all(promises);
    });
  }

  public delete(ids: number[]) {
    return this.sql<GlobalMaliciousUrl[]>`
      DELETE FROM malicious_urls
      WHERE url_id = ANY(${this.sql.array(ids)})
      RETURNING *
    `;
  }
}
