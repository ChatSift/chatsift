import type { SelfAssignableRole } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';
import { PromptsController } from './PromptsController';

interface EmojiData {
  id: Snowflake;
  name: string;
  animated: boolean;
}

@singleton()
export class AssignablesController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>,
    public readonly prompts: PromptsController
  ) {}

  public get(roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    return this
      .sql<[SelfAssignableRole?]>`SELECT * FROM self_assignable_roles WHERE role_id = ${roleId} ORDER BY id`
      .then(rows => rows[0]);
  }

  public getAllForPrompt(prompt: number): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE prompt_id = ${prompt} ORDER BY id`;
  }

  public getAll(guildId: Snowflake): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE guild_id = ${guildId} ORDER BY id`;
  }

  public async add(guildId: Snowflake, prompt: number, roleId: Snowflake, emoji?: EmojiData): Promise<SelfAssignableRole | undefined> {
    if (await this.get(roleId)) {
      return;
    }

    if (emoji) {
      return this
        .sql<[SelfAssignableRole]>`
          INSERT INTO self_assignable_roles (role_id, prompt_id, guild_id, emoji_id, emoji_name, emoji_animated)
          VALUES (${roleId}, ${prompt}, ${guildId}, ${emoji.id}, ${emoji.name}, ${emoji.animated})
          RETURNING *
        `
        .then(rows => rows[0]);
    }

    return this
      .sql<[SelfAssignableRole]>`
        INSERT INTO self_assignable_roles (role_id, prompt_id, guild_id)
        VALUES (${roleId}, ${prompt}, ${guildId})
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public delete(roleId: Snowflake): Promise<SelfAssignableRole | undefined> {
    return this
      .sql<[SelfAssignableRole?]>`DELETE FROM self_assignable_roles WHERE role_id = ${roleId} RETURNING *`
      .then(rows => rows[0]);
  }

  public deleteAllForPrompt(prompt: number): Promise<SelfAssignableRole[]> {
    return this.sql<SelfAssignableRole[]>`
      DELETE FROM self_assignable_roles
      WHERE prompt_id = ${prompt}
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
