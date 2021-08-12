import { FilterCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import {
    ApiGetFiltersIgnoresChannelResult, ApiGetFiltersIgnoresResult, ApiGetGuildsSettingsResult, ApiPatchFiltersIgnoresChannelBody, ApiPatchFiltersIgnoresChannelResult, ApiPatchGuildSettingsBody, ApiPatchGuildSettingsResult, GuildSettings
} from '@automoderator/core';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import { APIGuildInteraction, ChannelType, RESTGetAPIGuildChannelsResult, Routes } from 'discord-api-types/v9';
import { singleton } from 'tsyringe';
import { Command } from '../../../../command';

@singleton()
export class FilterConfig implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
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
        const { channel, ...filters } = args.ignore;

        if (channel.type !== ChannelType.GuildText) {
          throw new ControlFlowError('Please provide a text channel');
        }

        const existing = await this.rest
          .get<ApiGetFiltersIgnoresChannelResult>(`/guilds/${interaction.guild_id}/filters/ignores/${channel.id}`)
          .catch(() => null);

        const bitfield = new FilterIgnores(BigInt(existing?.value ?? '0'));

        for (const [filter, on] of Object.entries(filters) as [keyof typeof filters, boolean][]) {
          if (on) {
            bitfield.add(filter);
          } else {
            bitfield.remove(filter);
          }
        }

        await this.rest.patch<ApiPatchFiltersIgnoresChannelResult, ApiPatchFiltersIgnoresChannelBody>(
          `/guilds/${interaction.guild_id}/filters/ignores/${channel.id}`, {
            value: bitfield.toJSON() as `${bigint}`
          }
        );

        const enabled = bitfield.toArray();
        return send(interaction, {
          content: enabled.length
            ? `The following filters are now being ignored in the given channel: ${enabled.join(', ')}`
            : 'No filters are being ignored in the given channel anymore.'
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
