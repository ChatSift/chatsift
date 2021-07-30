import { injectable } from 'tsyringe';
import { Component } from '../component';
import { send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { APIGuildInteraction, ComponentType, InteractionResponseType, RESTGetAPIGuildRolesResult, Routes } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import type { ApiGetGuildsAssignablesResult } from '@automoderator/core';

@injectable()
export default class implements Component {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public async exec(interaction: APIGuildInteraction) {
    await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

    const selfAssignables = await this.rest
      .get<ApiGetGuildsAssignablesResult>(`/guilds/${interaction.guild_id}/assignables`)
      .then(roles => roles.map(role => role.role_id));

    const userRoles = new Set(interaction.member.roles);

    const roles = new Map(
      await this.discordRest
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
        void this.rest.delete(`/guilds/${interaction.guild_id}/assignables/${roleId}`).catch(() => null);
      }

      return arr;
    }, []);

    if (!menuOptions.length) {
      return send(interaction, { content: 'There are no self assignable roles configured for this server', flags: 64 });
    }

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
    });
  }
}
