import type { SelfAssignableRole } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

@singleton()
export class AssignablesController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public get(roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    return this
      .sql<[SelfAssignableRole?]>`SELECT * FROM self_assignable_roles WHERE role_id = ${roleId}`
      .then(rows => rows[0]);
  }

  public getAllForMessage(messageId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles message_id = ${messageId}`;
  }

  public getAll(guildId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE guild_id = ${guildId}`;
  }

  public async add(guildId: Snowflake, messageId: Snowflake, roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    if (await this.get(roleId)) {
      return;
    }

    return this
      .sql<[SelfAssignableRole]>`
        INSERT INTO self_assignable_roles (role_id, message_id, guild_id)
        VALUES (${roleId}, ${messageId}, ${guildId})
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public delete(roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    return this
      .sql<[SelfAssignableRole?]>`DELETE FROM self_assignable_roles WHERE role_id = ${roleId} RETURNING *`
      .then(rows => rows[0]);
  }

  public deleteAllForMessage(messageId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`
      DELETE FROM self_assignable_roles
      WHERE message_id = ${messageId}
      RETURNING *
    `;
  }

  public deleteAll(guildId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`
      DELETE FROM self_assignable_roles
      WHERE guild_id = ${guildId}
      RETURNING *
    `;
  }
}
