import type { SelfAssignableRolePrompt, SelfAssignableRole } from '@automoderator/core';
import { kSql } from '@automoderator/injection';
import type { Snowflake } from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, singleton } from 'tsyringe';

export type PromptData = SelfAssignableRolePrompt & { roles: SelfAssignableRole[] };

@singleton()
export class PromptsController {
  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public async get(gid: Snowflake, pid: number): Promise<PromptData | undefined> {
    const [prompt] = await this.sql<[SelfAssignableRolePrompt?]>`SELECT * FROM self_assignable_roles_prompts WHERE guild_id = ${gid} AND prompt_id = ${pid}`;

    if (prompt) {
      const roles = await this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE prompt_id = ${pid} ORDER BY id`;
      return { ...prompt, roles };
    }
  }

  public async getByMessage(id: Snowflake): Promise<PromptData | undefined> {
    const [prompt] = await this.sql<[SelfAssignableRolePrompt?]>`SELECT * FROM self_assignable_roles_prompts WHERE message_id = ${id}`;

    if (prompt) {
      const roles = await this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE prompt_id = ${prompt.prompt_id} ORDER BY id`;
      return { ...prompt, roles };
    }
  }

  public async getAll(guild: Snowflake): Promise<PromptData[]> {
    const prompts = await this.sql<SelfAssignableRolePrompt[]>`SELECT * FROM self_assignable_roles_prompts WHERE guild_id = ${guild}`;
    const roles = await this.sql<SelfAssignableRole[]>`SELECT * FROM self_assignable_roles WHERE guild_id = ${guild} ORDER BY id`;

    const groupedRoles = roles.reduce<Record<number, SelfAssignableRole[]>>((acc, role) => {
      (acc[role.prompt_id] ??= []).push(role);
      return acc;
    }, {});

    return prompts.map(prompt => ({ ...prompt, roles: groupedRoles[prompt.prompt_id] ?? [] }));
  }

  public add(data: Partial<Omit<SelfAssignableRolePrompt, 'prompt_id'>>): Promise<SelfAssignableRolePrompt> {
    return this
      .sql<[SelfAssignableRolePrompt]>`INSERT INTO self_assignable_roles_prompts ${this.sql(data)} RETURNING *`
      .then(rows => rows[0]);
  }

  public update(data: {
    prompt_id: number;
    guild_id: Snowflake;
    channel_id?: Snowflake;
    message_id?: Snowflake;
  }): Promise<SelfAssignableRolePrompt | undefined> {
    const { prompt_id, guild_id, ...update } = data;
    return this
      .sql<[SelfAssignableRolePrompt?]>`
        UPDATE self_assignable_roles_prompts SET ${this.sql(update)}
        WHERE prompt_id = ${prompt_id}
          AND guild_id = ${guild_id}
        RETURNING *
      `
      .then(rows => rows[0]);
  }

  public delete(gid: Snowflake, pid: number): Promise<SelfAssignableRolePrompt | undefined> {
    return this
      .sql<[SelfAssignableRolePrompt?]>`DELETE FROM self_assignable_roles_prompts WHERE guild_id = ${gid} AND prompt_id = ${pid} RETURNING *`
      .then(rows => rows[0]);
  }

  public deleteAll(guild: Snowflake): Promise<SelfAssignableRolePrompt[]> {
    return this.sql`DELETE FROM self_assignable_roles_prompts WHERE guild_id = ${guild} RETURNING *`;
  }
}
