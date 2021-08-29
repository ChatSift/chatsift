import { FilterCommand } from '#interactions';
import { ArgumentsOf, FilterIgnoresStateStore, send } from '#util';
import {
  ApiGetFiltersIgnoresResult,
  ApiGetGuildsSettingsResult,
  ApiPatchGuildSettingsBody,
  ApiPatchGuildSettingsResult,
  ellipsis,
  GuildSettings
} from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
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
import { singleton } from 'tsyringe';
import { Command } from '../../../../command';

@singleton()
export class FilterConfig implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly filterIgnoreState: FilterIgnoresStateStore
  ) {}

  private async sendCurrentSettings(interaction: APIGuildInteraction) {
    const settings = await this.rest
      .get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`)
      .catch(() => null);

    return send(interaction, {
      content: stripIndents`
        **Here are your current filter settings:**
        • url filter: ${settings?.use_url_filters ? 'on' : 'off'}
        • file filter: ${settings?.use_file_filters ? 'on' : 'off'}
        • invite filter: ${settings?.use_invite_filters ? 'on' : 'off'}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['config']) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'show': {
        return this.sendCurrentSettings(interaction);
      }

      case 'edit': {
        let settings: Partial<GuildSettings> = {};

        if (args.edit.urls != null) {
          settings.use_url_filters = args.edit.urls;
        }

        if (args.edit.files != null) {
          settings.use_file_filters = args.edit.files;
        }

        if (args.edit.invites != null) {
          settings.use_invite_filters = args.edit.invites;
        }

        if (!Object.values(settings).length) {
          return this.sendCurrentSettings(interaction);
        }

        settings = await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(
          `/guilds/${interaction.guild_id}/settings`,
          settings
        );

        return this.sendCurrentSettings(interaction);
      }

      case 'ignore': {
        const channels = await this.discordRest
          .get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
          .then(
            channels => channels.filter(
              channel => channel.type === ChannelType.GuildCategory || channel.type === ChannelType.GuildText
            )
          );

        const id = nanoid();

        const maxPages = Math.ceil(channels.length / 25);
        void this.filterIgnoreState.set(id, { page: 0, maxPages });

        return send(interaction, {
          content: 'Please select a channel...',
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.SelectMenu,
                  custom_id: `filter-ignores-channel-select|${id}`,
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
                  custom_id: `filter-ignores-channel-select-page|${id}|back`,
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
                  custom_id: `filter-ignores-channel-select-page|${id}|forward`,
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
                  label: 'URLs',
                  custom_id: `filter-ignores-update|${id}|urls`,
                  style: ButtonStyle.Danger,
                  disabled: true
                },
                {
                  type: ComponentType.Button,
                  label: 'Files',
                  custom_id: `filter-ignores-update|${id}|files`,
                  style: ButtonStyle.Danger,
                  disabled: true
                }, {
                  type: ComponentType.Button,
                  label: 'Invites',
                  custom_id: `filter-ignores-update|${id}|invites`,
                  style: ButtonStyle.Danger,
                  disabled: true
                },
                {
                  type: ComponentType.Button,
                  label: 'Words',
                  custom_id: `filter-ignores-update|${id}|words`,
                  style: ButtonStyle.Danger,
                  disabled: true
                },
                {
                  type: ComponentType.Button,
                  label: 'Done',
                  custom_id: `filter-ignores-done|${id}`,
                  style: ButtonStyle.Secondary
                }
              ]
            }
          ]
        });
      }

      case 'ignorelist': {
        const channels = new Map(
          await this.discordRest.get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
            .then(
              channels => channels.map(
                channel => [channel.id, channel]
              )
            )
        );

        const entries = await this.rest.get<ApiGetFiltersIgnoresResult>(`/guilds/${interaction.guild_id}/filters/ignores`);
        const ignores = entries.reduce<string[]>((acc, entry) => {
          const channel = channels.get(entry.channel_id);
          if (channel) {
            const channelMention = channel.type === ChannelType.GuildText ? `<#${channel.id}>` : channel.name;
            const enabled = new FilterIgnores(BigInt(entry.value)).toArray();

            if (enabled.length) {
              acc.push(`• ${channelMention}: ${enabled.join(', ')}`);
            }
          }

          return acc;
        }, []);

        return send(interaction, {
          content: entries.length
            ? `Here are your current ignores:\n${ignores.join('\n')}`
            : 'There are no ignores currently enabled'
        });
      }
    }
  }
}
