import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { GlobalMaliciousFile, MaliciousFileCategory } from '@automoderator/core';
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
export class FilesController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(page: number): Promise<GlobalMaliciousFile[]> {
    return this.sql`
      SELECT * FROM malicious_files
      WHERE guild_id IS NULL
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(): Promise<GlobalMaliciousFile[]> {
    return this.sql`SELECT * FROM malicious_files WHERE guild_id IS NULL`;
  }

  public getHitsFrom(hashes: string[]): Promise<GlobalMaliciousFile[]> {
    return this.sql<GlobalMaliciousFile[]>`
      SELECT *
      FROM malicious_files
      WHERE file_hash = ANY(${this.sql.array(hashes)}) AND guild_id IS NULL
    `;
  }

  public async updateBulk(files: { file_id: number; category: MaliciousFileCategory }[]): Promise<Result<GlobalMaliciousFile[]>> {
    const data = await this.sql
      .begin(async sql => {
        const updated: GlobalMaliciousFile[] = [];

        for (const file of files) {
          const [data] = await sql<[GlobalMaliciousFile?]>`
            UPDATE malicious_files
            SET category = ${file.category}, last_modified_at = NOW()
            WHERE file_id = ${file.file_id}
              AND guild_id IS NULL
            RETURNING *
          `;

          if (!data) {
            return Promise.reject(`nothing to update for file ${file.file_id}`);
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

  public add(files: { hash: string; admin: Snowflake; category: MaliciousFileCategory }[]) {
    return this.sql.begin(sql => {
      const promises: Promise<GlobalMaliciousFile>[] = [];

      for (const data of files) {
        const promise = sql<[GlobalMaliciousFile]>`
          INSERT INTO malicious_files (file_hash, admin_id, category)
          VALUES (${data.hash}, ${data.admin}, ${data.category})
          ON CONFLICT (file_hash)
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
    return this.sql<GlobalMaliciousFile[]>`
      DELETE FROM malicious_files
      WHERE file_id = ANY(${this.sql.array(ids)})
      RETURNING *
    `;
  }
}
