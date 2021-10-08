import type { AllowedInvite } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class InvitesAllowlistController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(guildId: Snowflake, allowed: Snowflake): Promise<AllowedInvite | undefined> {
    return this
      .sql<[AllowedInvite?]>`SELECT * FROM allowed_invites WHERE guild_id = ${guildId} AND allowed_guild_id = ${allowed}`
      .then(rows => rows[0]);
  }

  public getAll(guildId: Snowflake): Promise<AllowedInvite[]> {
    return this.sql<AllowedInvite[]>`SELECT * FROM allowed_invites WHERE guild_id = ${guildId}`;
  }

  public async add(guildId: Snowflake, allowed: Snowflake): Promise<AllowedInvite | undefined> {
    if (await this.get(guildId, allowed)) {
      return;
    }

    return this
      .sql<[AllowedInvite]>`INSERT INTO allowed_invites (guild_id, allowed_guild_id) VALUES (${guildId}, ${allowed}) RETURNING *`
      .then(rows => rows[0]);
  }

  public delete(guildId: Snowflake, allowed: Snowflake): Promise<AllowedInvite | undefined> {
    return this
      .sql<AllowedInvite[]>`
        DELETE FROM allowed_invites
        WHERE guild_id = ${guildId} AND allowed_guild_id = ${allowed}
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
