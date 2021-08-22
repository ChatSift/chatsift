import { RolesCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import { ApiGetGuildsAssignablesResult, ApiGetGuildsSettingsResult, ApiPatchGuildSettingsBody } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, ButtonStyle, ComponentType } from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  private handleHttpError(interaction: APIGuildInteraction, error: HTTPError) {
    switch (error.statusCode) {
      case 404:
      case 409: {
        return send(interaction, { content: error.message, flags: 64 });
      }

      default: {
        throw error;
      }
    }
  }

  private async handlePrompt(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>['prompt']) {
    switch (Object.keys(args)[0] as 'display' | 'set') {
      case 'display': {
        const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

        const { token, ...message } = interaction;
        await send(message, {
          embed: {
            title: 'Hey there! How about if we get you set up with some roles?',
            color: 5793266,
            description: settings.assignable_roles_prompt ??
              'Use the button below to show a dropdown that allows you to manage your roles!'
          },
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: 'Manage your roles',
                  style: ButtonStyle.Primary,
                  custom_id: `roles-manage-prompt|${nanoid()}`
                }
              ]
            }
          ]
        });

        return send(interaction, { content: 'Successfully posted the prompt', flags: 64 });
      }

      case 'set': {
        await this.rest.patch<unknown, ApiPatchGuildSettingsBody>(`/guilds/${interaction.guild_id}/settings`, {
          assignable_roles_prompt: args.set.prompt
        });

        return send(interaction, { content: 'Successfully updated your prompt' });
      }
    }
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RolesCommand>) {
    switch (Object.keys(args)[0] as 'prompt' | 'add' | 'remove' | 'list') {
      case 'prompt': {
        return this.handlePrompt(interaction, args.prompt);
      }

      case 'add': {
        try {
          await this.rest.put(`/guilds/${interaction.guild_id}/assignables/${args.add.role.id}`);
          return send(interaction, { content: 'Successfully registered the given role as a self assignable role' });
        } catch (error) {
          if (error instanceof HTTPError) {
            return this.handleHttpError(interaction, error);
          }

          throw error;
        }
      }

      case 'remove': {
        try {
          await this.rest.delete(`/guilds/${interaction.guild_id}/assignables/${args.remove.role.id}`);
          return send(interaction, { content: 'Successfully removed the given role from the list of self assignable roles' });
        } catch (error) {
          if (error instanceof HTTPError) {
            return this.handleHttpError(interaction, error);
          }

          throw error;
        }
      }

      case 'list': {
        const roles = await this.rest.get<ApiGetGuildsAssignablesResult>(`/guilds/${interaction.guild_id}/assignables`);
        if (!roles.length) {
          return send(interaction, { content: 'There are no currently self assignable roles' });
        }

        return send(interaction, {
          content: `List of currently self assignable roles: ${roles.map(r => `<@&${r.role_id}>`).join(', ')}`,
          allowed_mentions: { parse: [] }
        });
      }
    }
  }
}
