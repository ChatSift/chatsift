import { kSql } from '@automoderator/injection';
import { inject, singleton } from 'tsyringe';
import type { Sql } from 'postgres';
import type { AllowedInvite } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';

@singleton()
export class InvitesAllowlistController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(guildId: Snowflake, code: string): Promise<AllowedInvite | undefined> {
    return this
      .sql<[AllowedInvite?]>`SELECT * FROM allowed_invites WHERE guild_id = ${guildId} AND invite_code = ${code}`
      .then(rows => rows[0]);
  }

  public getAll(guildId: Snowflake): Promise<AllowedInvite[]> {
    return this.sql<AllowedInvite[]>`SELECT * FROM allowed_invites WHERE guild_id = ${guildId}`;
  }

  public async add(guildId: Snowflake, code: string): Promise<AllowedInvite | undefined> {
    if (await this.get(guildId, code)) {
      return;
    }

    return this
      .sql<[AllowedInvite]>`INSERT INTO allowed_invites (guild_id, invite_code) VALUES (${guildId}, ${code}) RETURNING *`
      .then(rows => rows[0]);
  }

  public delete(guildId: Snowflake, code: string): Promise<AllowedInvite | undefined> {
    return this
      .sql<AllowedInvite[]>`
        DELETE FROM allowed_invites
        WHERE guild_id = ${guildId} AND invite_code = ${code}
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public deleteAll(guildId: Snowflake): Promise<AllowedInvite[]> {
    return this.sql<AllowedInvite[]>`
      DELETE FROM allowed_invites
      WHERE guild_id = ${guildId}
      RETURNING *
    `;
  }
}
