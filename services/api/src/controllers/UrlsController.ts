import type { MaliciousUrl, MaliciousUrlCategory } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

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
	public constructor(@inject(kSql) public readonly sql: Sql<{}>) {}

	public get(page: number): Promise<MaliciousUrl[]> {
		return this.sql`
      SELECT * FROM malicious_urls
      LIMIT 100
      OFFSET ${page * 100}
    `;
	}

	public getAll(): Promise<MaliciousUrl[]> {
		return this.sql`SELECT * FROM malicious_urls`;
	}

	public getHitsFrom(urls: string[]): Promise<MaliciousUrl[]> {
		return this.sql<MaliciousUrl[]>`
      SELECT *
      FROM malicious_urls
      WHERE url = ANY(${this.sql.array(urls)})
    `;
	}

	public async updateBulk(urls: { url_id: number; category: MaliciousUrlCategory }[]): Promise<Result<MaliciousUrl[]>> {
		const data = await this.sql
			.begin(async (sql) => {
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

		return Array.isArray(data) ? { success: true, value: data } : { success: false, error: data };
	}

	public add(urls: { url: string; category: MaliciousUrlCategory }[]) {
		return this.sql.begin((sql) => {
			const promises: Promise<MaliciousUrl>[] = [];

			for (const data of urls) {
				const promise = sql<[MaliciousUrl]>`
          INSERT INTO malicious_urls (url, category)
          VALUES (${data.url}, ${data.category})
          ON CONFLICT (url)
          DO
            UPDATE SET category = ${data.category}, last_modified_at = NOW()
            RETURNING *
        `.then((rows) => rows[0]);

				promises.push(promise);
			}

			return Promise.all(promises);
		});
	}

	public delete(ids: number[]) {
		return this.sql<MaliciousUrl[]>`
      DELETE FROM malicious_urls
      WHERE url_id = ANY(${this.sql.array(ids)})
      RETURNING *
    `;
	}
}
