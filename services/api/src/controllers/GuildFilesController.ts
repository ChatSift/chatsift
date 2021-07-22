import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { LocalMaliciousFile, MaliciousFile } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v8';

@singleton()
export class GuildFilesController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(page: number, guildId: Snowflake): Promise<LocalMaliciousFile[]> {
    return this.sql`
      SELECT * FROM malicious_files
      WHERE guild_id = ${guildId}
      LIMIT 100
      OFFSET ${page * 100}
    `;
  }

  public getAll(guildId: Snowflake): Promise<LocalMaliciousFile[]> {
    return this.sql`SELECT * FROM malicious_files WHERE guild_id = ${guildId}`;
  }

  public getHitsFrom(hashes: string[], guildId: Snowflake, guildOnly: true): Promise<LocalMaliciousFile[]>;
  public getHitsFrom(hashes: string[], guildId: Snowflake, guildOnly?: false): Promise<MaliciousFile[]>;
  public getHitsFrom(hashes: string[], guildId: Snowflake, guildOnly: boolean): Promise<MaliciousFile[]>;
  public getHitsFrom(hashes: string[], guildId: Snowflake, guildOnly = false): Promise<MaliciousFile[]> {
    if (guildOnly) {
      return this.sql<LocalMaliciousFile[]>`
        SELECT *
        FROM malicious_files
        WHERE file_hash = ANY(${this.sql.array(hashes)}) AND guild_id = ${guildId}
      `;
    }

    return this.sql<MaliciousFile[]>`
      SELECT *
      FROM malicious_files
      WHERE file_hash = ANY(${this.sql.array(hashes)}) AND (guild_id = ${guildId} OR guild_id IS NULL)
    `;
  }

  public add(hashes: string[], guildId: Snowflake) {
    return this.sql.begin(sql => {
      const promises: Promise<LocalMaliciousFile>[] = [];

      for (const hash of hashes) {
        const promise = sql<[LocalMaliciousFile]>`
          INSERT INTO malicious_files (file_hash, guild_id)
          VALUES (${hash}, ${guildId})
          ON CONFLICT (file_hash)
          DO
            UPDATE SET last_modified_at = NOW()
            RETURNING *
        `.then(rows => rows[0]);

        promises.push(promise);
      }

      return Promise.all(promises);
    });
  }

  public delete(hashes: string[], guildId: Snowflake) {
    return this.sql<LocalMaliciousFile[]>`
      DELETE FROM malicious_files
      WHERE file_hash = ANY(${this.sql.array(hashes)})
        AND guild_id = ${guildId}
      RETURNING *
    `;
  }
}
