import { RolesCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import {
  ApiGetGuildPromptResult,
  ApiGetGuildPromptsResult,
  ApiPatchGuildPromptBody,
  ApiPutGuildsAssignablesRoleBody,
  SelfAssignableRolePrompt,
  ApiPutGuildPromptsBody,
  ApiPutGuildPromptsResult,
  SelfAssignableRole
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { kLogger } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  RESTPostAPIChannelMessageJSONBody,
  APIMessage,
  ButtonStyle,
  ComponentType,
  Routes
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kLogger) public readonly logger: Logger
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
    switch (Object.keys(args)[0] as 're-display' | 'delete' | 'create') {
      case 're-display': {
        const prompt = await this.rest.get<ApiGetGuildPromptResult>(`/guilds/${interaction.guild_id}/prompts/${args['re-display'].id}`);

        const promptMessage = await this.discordRest.post<APIMessage, RESTPostAPIChannelMessageJSONBody>(
          Routes.channelMessages(args['re-display'].channel?.id ?? interaction.channel_id), {
            data: {
              embed: {
                title: prompt.embed_title,
                color: prompt.embed_color,
                description: prompt.embed_description ?? undefined,
                image: prompt.embed_image
                  ? {
                    url: prompt.embed_image
                  }
                  : undefined
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
            }
          }
        );

        await this.rest.patch<unknown, ApiPatchGuildPromptBody>(`/guilds/${interaction.guild_id}/prompts/${args['re-display'].id}`, {
          channel_id: promptMessage.channel_id,
          message_id: promptMessage.id
        });

        return send(interaction, { content: 'Successfully re-posted the prompt', flags: 64 });
      }

      case 'delete': {
        try {
          await this.rest.delete<unknown>(`/guilds/${interaction.guild_id}/prompts/${args.delete.id}`);
          return send(interaction, { content: 'Successfully deleted your prompt' });
        } catch (error) {
          if (error instanceof HTTPError) {
            return this.handleHttpError(interaction, error);
          }

          throw error;
        }
      }

      case 'create': {
        const channelId = args.create.channel?.id ?? interaction.channel_id;
        const color = args.create.color ? parseInt(args.create.color.replace('#', ''), 16) : 5793266;

        const promptMessage = await this.discordRest.post<APIMessage, RESTPostAPIChannelMessageJSONBody>(
          Routes.channelMessages(channelId), {
            data: {
              embed: {
                title: args.create.title,
                color,
                description: args.create.description,
                image: args.create.imageurl
                  ? {
                    url: args.create.imageurl
                  }
                  : undefined
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
            }
          }
        );

        const prompt = await this.rest.put<ApiPutGuildPromptsResult, ApiPutGuildPromptsBody>(
          `/guilds/${interaction.guild_id}/prompts`, {
            channel_id: channelId,
            message_id: promptMessage.id,
            embed_color: color,
            embed_title: args.create.title,
            embed_description: args.create.description,
            embed_image: args.create.imageurl
          }
        );

        return send(interaction, { content: `Successfully created your prompt with an id of ${prompt.prompt_id}`, flags: 64 });
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
          await this.rest.put<unknown, ApiPutGuildsAssignablesRoleBody>(
            `/guilds/${interaction.guild_id}/assignables/roles/${args.add.role.id}`, {
              prompt_id: args.add.prompt
            }
          );

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
          await this.rest.delete(`/guilds/${interaction.guild_id}/assignables/roles/${args.remove.role.id}`);
          return send(interaction, { content: 'Successfully removed the given role from the list of self assignable roles' });
        } catch (error) {
          if (error instanceof HTTPError) {
            return this.handleHttpError(interaction, error);
          }

          throw error;
        }
      }

      case 'list': {
        const prompts = await this.rest.get<ApiGetGuildPromptsResult>(`/guilds/${interaction.guild_id}/prompts`);
        if (!prompts.length) {
          return send(interaction, { content: 'There are no registered prompts' });
        }

        const data = prompts
          .map(prompt => {
            const formatPrompt = (prompt: SelfAssignableRolePrompt) =>
              `[Prompt ID ${prompt.prompt_id}](<https://discord.com/channels/${interaction.guild_id}/${prompt.channel_id}/${prompt.message_id}>)`;

            const formatRoles = (roles: SelfAssignableRole[]) => roles.length
              ? roles.map(r => `<@&${r.role_id}>`).join(', ')
              : 'no roles - please set some';

            return `• ${formatPrompt(prompt)}: ${formatRoles(prompt.roles)}`;
          })
          .join('\n');

        return send(interaction, {
          content: `**List of prompts and their self assignable roles**:\n${data}`,
          allowed_mentions: { parse: [] }
        });
      }
    }
  }
}
