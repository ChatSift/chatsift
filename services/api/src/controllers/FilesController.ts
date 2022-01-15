import type { MaliciousFile, MaliciousFileCategory } from '@automoderator/core';
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
export class FilesController {
	public constructor(@inject(kSql) public readonly sql: Sql<{}>) {}

	public get(page: number): Promise<MaliciousFile[]> {
		return this.sql`
      SELECT * FROM malicious_files
      LIMIT 100
      OFFSET ${page * 100}
    `;
	}

	public getAll(): Promise<MaliciousFile[]> {
		return this.sql`SELECT * FROM malicious_files`;
	}

	public getHitsFrom(hashes: string[]): Promise<MaliciousFile[]> {
		return this.sql<MaliciousFile[]>`
      SELECT *
      FROM malicious_files
      WHERE file_hash = ANY(${this.sql.array(hashes)})
    `;
	}

	public async updateBulk(
		files: { file_id: number; category: MaliciousFileCategory }[],
	): Promise<Result<MaliciousFile[]>> {
		const data = await this.sql
			.begin(async (sql) => {
				const updated: MaliciousFile[] = [];

				for (const file of files) {
					const [data] = await sql<[MaliciousFile?]>`
            UPDATE malicious_files
            SET category = ${file.category}, last_modified_at = NOW()
            WHERE file_id = ${file.file_id}
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

		return Array.isArray(data) ? { success: true, value: data } : { success: false, error: data };
	}

	public add(files: { hash: string; category: MaliciousFileCategory }[]) {
		return this.sql.begin((sql) => {
			const promises: Promise<MaliciousFile>[] = [];

			for (const data of files) {
				const promise = sql<[MaliciousFile]>`
          INSERT INTO malicious_files (file_hash, category)
          VALUES (${data.hash}, ${data.category})
          ON CONFLICT (file_hash)
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
		return this.sql<MaliciousFile[]>`
      DELETE FROM malicious_files
      WHERE file_id = ANY(${this.sql.array(ids)})
      RETURNING *
    `;
	}
}
