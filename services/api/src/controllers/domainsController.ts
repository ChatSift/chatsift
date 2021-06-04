import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { MaliciousDomain, MaliciousDomainCategory } from '@automoderator/core';

interface Ok<T> {
  success: true;
  value: T;
}

interface NotOk {
  success: false;
  error: string;
}

type Result<T> = Ok<T> | NotOk;

type AddMeta = { admin: string; category: MaliciousDomainCategory } | { guild: string };

@singleton()
export class DomainsController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(page: number, guildId?: string) {
    return this.sql<MaliciousDomain[]>`
      SELECT * FROM malicious_domains
      WHERE guild_id = ${guildId ?? null}
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(guildId?: string) {
    return this.sql<MaliciousDomain[]>`SELECT * FROM malicious_domains WHERE guild_id = ${guildId ?? null}`;
  }

  public getHitsFrom(domains: string[], guildId: string, guildOnly: true): Promise<Pick<MaliciousDomain, 'domain' | 'category'>[]>;
  public getHitsFrom(domains: string[], guildId?: string, guildOnly?: boolean): Promise<Pick<MaliciousDomain, 'domain' | 'category'>[]>;
  public getHitsFrom(domains: string[], guildId?: string, guildOnly = false) {
    if (guildOnly) {
      return this.sql<Pick<MaliciousDomain, 'domain' | 'category'>[]>`
        SELECT domain, category
        FROM malicious_domains
        WHERE domain = ANY(${this.sql.array(domains)}), guild_id = ${guildId!}
      `;
    }

    return this.sql<Pick<MaliciousDomain, 'domain' | 'category'>[]>`
      SELECT domain, category
      FROM malicious_domains
      WHERE domain = ANY(${this.sql.array(domains)}) AND (guild_id = ${guildId!} OR guild_id = null)
    `;
  }

  public async updateBulk(domains: { domain_id: number; category: MaliciousDomainCategory }[]): Promise<Result<MaliciousDomain[]>> {
    const data = await this.sql
      .begin(async sql => {
        const updated: MaliciousDomain[] = [];

        for (const domain of domains) {
          const [data] = await sql<[MaliciousDomain?]>`
            UPDATE malicious_domains
            SET category = ${domain.category}, last_modified_at = NOW()
            WHERE domain_id = ${domain.domain_id}
            RETURNING *
          `;

          if (!data) {
            return Promise.reject(`nothing to update for domain ${domain.domain_id}`);
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

  public async add(domain: string, meta: AddMeta) {
    const category = 'category' in meta ? meta.category : null;

    return (await this.sql<[MaliciousDomain]>`
      INSERT INTO malicious_domains (domain, guild_id, admin_id, category)
      VALUES (${domain}, ${'guild' in meta ? meta.guild : null}, ${'admin' in meta ? meta.admin : null}, ${category})
      ON CONFLICT (domain)
      DO
        UPDATE SET category = ${category}, last_modified_at = NOW()
        RETURNING *
    `)[0];
  }
}
