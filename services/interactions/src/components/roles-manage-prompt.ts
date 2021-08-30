import { send } from '#util';
import type { ApiGetGuildPromptResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  ComponentType,
  InteractionResponseType,
  RESTGetAPIGuildRolesResult,
  APISelectMenuOption,
  Routes
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import { Component } from '../component';

@injectable()
export default class implements Component {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public async exec(interaction: APIGuildInteraction) {
    await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);

    const prompt = await this.rest.get<ApiGetGuildPromptResult>(
      `/guilds/${interaction.guild_id}/prompts/messages/${interaction.message!.id}`
    );

    const selfAssignables = prompt.roles.map(role => role.role_id);
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

    const menuOptions = selfAssignables.reduce<APISelectMenuOption[]>((arr, roleId) => {
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
      return send(interaction, {
        content: 'There are no self assignable roles configured for that prompt, you should inform an admin',
        flags: 64
      });
    }

    return send(interaction, {
      content: 'Use the drop-down below to manage your roles!',
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.SelectMenu,
              custom_id: `roles-manage|${nanoid()}|${prompt.prompt_id}`,
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
