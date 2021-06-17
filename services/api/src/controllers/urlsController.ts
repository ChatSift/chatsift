import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { MaliciousUrl, MaliciousUrlCategory } from '@automoderator/core';

interface Ok<T> {
  success: true;
  value: T;
}

interface NotOk {
  success: false;
  error: string;
}

type Result<T> = Ok<T> | NotOk;

type AddMeta = { admin: string; category: MaliciousUrlCategory } | { guild: string };

@singleton()
export class UrlsController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(page: number, guildId?: string) {
    return this.sql<MaliciousUrl[]>`
      SELECT * FROM malicious_urls
      WHERE guild_id = ${guildId ?? null}
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(guildId?: string) {
    return this.sql<MaliciousUrl[]>`SELECT * FROM malicious_urls WHERE guild_id = ${guildId ?? null}`;
  }

  public getHitsFrom(urls: string[], guildId: string, guildOnly: true): Promise<Pick<MaliciousUrl, 'url' | 'category'>[]>;
  public getHitsFrom(urls: string[], guildId?: string, guildOnly?: boolean): Promise<Pick<MaliciousUrl, 'url' | 'category'>[]>;
  public getHitsFrom(urls: string[], guildId?: string, guildOnly = false) {
    if (guildOnly) {
      return this.sql<Pick<MaliciousUrl, 'url' | 'category'>[]>`
        SELECT url, category
        FROM malicious_urls
        WHERE url = ANY(${this.sql.array(urls)}), guild_id = ${guildId!}
      `;
    }

    return this.sql<Pick<MaliciousUrl, 'url' | 'category'>[]>`
      SELECT url, category
      FROM malicious_urls
      WHERE url = ANY(${this.sql.array(urls)}) AND (guild_id = ${guildId!} OR guild_id = null)
    `;
  }

  public async updateBulk(urls: { url_id: number; category: MaliciousUrlCategory }[]): Promise<Result<MaliciousUrl[]>> {
    const data = await this.sql
      .begin(async sql => {
        const updated: MaliciousUrl[] = [];

        for (const url of urls) {
          const [data] = await sql<[MaliciousUrl?]>`
            UPDATE malicious_urls
            SET category = ${url.category}, last_modified_at = NOW()
            WHERE url_id = ${url.url_id}
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

  public async add(url: string, meta: AddMeta) {
    const category = 'category' in meta ? meta.category : null;

    return (await this.sql<[MaliciousUrl]>`
      INSERT INTO malicious_urls (url, guild_id, admin_id, category)
      VALUES (${url}, ${'guild' in meta ? meta.guild : null}, ${'admin' in meta ? meta.admin : null}, ${category})
      ON CONFLICT (url)
      DO
        UPDATE SET category = ${category}, last_modified_at = NOW()
        RETURNING *
    `)[0];
  }
}
