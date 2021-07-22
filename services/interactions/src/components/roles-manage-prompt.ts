import { inject, injectable } from 'tsyringe';
import { Component } from '../component';
import { kSql } from '@automoderator/injection';
import { send, UserPerms } from '#util';
import { APIGuildInteraction, ComponentType, InteractionResponseType, RESTGetAPIGuildRolesResult, Routes } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { Rest } from '@cordis/rest';
import type { Sql } from 'postgres';
import type { SelfAssignableRole } from '@automoderator/core';

@injectable()
export default class implements Component {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    @inject(kSql) public readonly sql: Sql<{}>,
    public readonly rest: Rest
  ) {}

  public async exec(interaction: APIGuildInteraction) {
    await send(interaction, { flags: 64 }, { type: InteractionResponseType.DeferredChannelMessageWithSource });

    const selfAssignables = await this
      .sql<Pick<SelfAssignableRole, 'role_id'>[]>`SELECT role_id FROM self_assignable_roles WHERE guild_id = ${interaction.guild_id}`
      .then(
        rows => rows.map(
          row => row.role_id
        )
      );

    const userRoles = new Set(interaction.member.roles);

    const roles = new Map(
      await this.rest
        .get<RESTGetAPIGuildRolesResult>(Routes.guildRoles(interaction.guild_id))
        .then(
          roles => roles.map(
            role => [role.id, role]
          )
        )
    );

    const menuOptions = selfAssignables.reduce<any[]>((arr, roleId) => {
      const role = roles.get(roleId);
      if (role) {
        arr.push({
          'label': role.name,
          'value': role.id,
          'default': userRoles.has(roleId)
        });
      } else {
        void this.sql`DELETE FROM self_assignable_roles WHERE role_id = ${roleId}`;
      }

      return arr;
    }, []);

    return send(interaction, {
      content: 'Use the drop-down below to manage your roles!',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.SelectMenu,
              custom_id: `roles-manage|${nanoid()}`,
              min_values: 0,
              max_values: menuOptions.length,
              options: menuOptions
            }
          ]
        }
      ],
      flags: 64
    }, { update: true });
  }
}
