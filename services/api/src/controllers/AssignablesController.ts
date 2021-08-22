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

  public getAll(guildId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE guild_id = ${guildId}`;
  }

  public async add(guildId: Snowflake, roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    if (await this.get(roleId)) {
      return;
    }

    return this
      .sql<[SelfAssignableRole]>`
        INSERT INTO self_assignable_roles (role_id, guild_id)
        VALUES (${roleId}, ${guildId})
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public delete(roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    return this
      .sql<[SelfAssignableRole?]>`DELETE FROM self_assignable_roles WHERE role_id = ${roleId} RETURNING *`
      .then(rows => rows[0]);
  }

  public deleteAll(guildId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`
      DELETE FROM self_assignable_roles
      WHERE guild_id = ${guildId}
      RETURNING *
    `;
  }
}
