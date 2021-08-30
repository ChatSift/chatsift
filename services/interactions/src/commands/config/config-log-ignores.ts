import { ConfigLogIgnoresCommand } from '#interactions';
import { ArgumentsOf, LogIgnoresStateStore, send } from '#util';
import { ApiGetGuildLogIgnoresResult, ellipsis } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import {
  APIGuildInteraction,
  APISelectMenuOption,
  RESTGetAPIGuildChannelsResult,
  ChannelType,
  ComponentType,
  ButtonStyle,
  Routes
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import { injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly logIgnoresStore: LogIgnoresStateStore
  ) {}

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof ConfigLogIgnoresCommand>) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'show': {
        const channels = new Map(
          await this.discordRest.get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
            .then(
              channels => channels.map(
                channel => [channel.id, channel]
              )
            )
        );

        const entries = await this.rest.get<ApiGetGuildLogIgnoresResult>(`/guilds/${interaction.guild_id}/settings/log-ignores`);
        const ignores = entries.reduce<string[]>((acc, entry) => {
          const channel = channels.get(entry.channel_id);
          if (channel) {
            acc.push(`• ${channel.type === ChannelType.GuildText ? `<#${channel.id}>` : channel.name}`);
          }

          return acc;
        }, []);

        return send(interaction, {
          content: entries.length
            ? `Here are your current ignores:\n${ignores.join('\n')}`
            : 'There are no ignores currently set'
        });
      }

      case 'update': {
        const channels = await this.discordRest
          .get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
          .then(
            channels => channels.filter(
              channel => channel.type === ChannelType.GuildCategory || channel.type === ChannelType.GuildText
            )
          );

        const id = nanoid();

        const maxPages = Math.ceil(channels.length / 25);
        void this.logIgnoresStore.set(id, { page: 0, maxPages });

        return send(interaction, {
          content: 'Please select a channel...',
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.SelectMenu,
                  custom_id: `log-ignores-channel-select|${id}`,
                  options: channels
                    .map((channel): APISelectMenuOption => ({
                      label: ellipsis(channel.name!, 25),
                      emoji: channel.type === ChannelType.GuildText
                        ? {
                          id: '779036156175188001',
                          name: 'ChannelText',
                          animated: false
                        }
                        : {
                          id: '816771723264393236',
                          name: 'ChannelCategory',
                          animated: false
                        },
                      value: channel.id
                    }))
                    .slice(0, 25)
                }
              ]
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: '<',
                  custom_id: `log-ignores-channel-select-page|${id}|back`,
                  style: ButtonStyle.Primary,
                  disabled: true
                },
                {
                  type: ComponentType.Button,
                  label: 'Change channel page',
                  custom_id: 'noop',
                  style: ButtonStyle.Secondary,
                  disabled: true
                }, {
                  type: ComponentType.Button,
                  label: '>',
                  custom_id: `log-ignores-channel-select-page|${id}|forward`,
                  style: ButtonStyle.Primary,
                  disabled: maxPages === 1
                }
              ]
            },
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: 'Ignored',
                  custom_id: `log-ignores-update|${id}`,
                  style: ButtonStyle.Danger,
                  disabled: true
                },
                {
                  type: ComponentType.Button,
                  label: 'Done',
                  custom_id: `log-ignores-done|${id}`,
                  style: ButtonStyle.Secondary
                }
              ]
            }
          ]
        });
      }
    }
  }
}
