import { inject, singleton } from 'tsyringe';
import { Command } from '../../../../command';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { FilterCommand } from '#interactions';
import { GuildSettings, UseFilterMode, FilterIgnore } from '@automoderator/core';
import { stripIndents } from 'common-tags';
import { kSql } from '@automoderator/injection';
import { APIGuildInteraction, ChannelType, Routes, RESTGetAPIGuildChannelsResult } from 'discord-api-types/v9';
import { FilterIgnores } from '@automoderator/filter-ignores';
import { Rest } from '@cordis/rest';
import type { Sql } from 'postgres';

@singleton()
export class FilterConfig implements Command {
  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private sendCurrentSettings(interaction: APIGuildInteraction, settings?: Partial<GuildSettings>) {
    const urlFilter = (settings?.use_url_filters ?? UseFilterMode.none) === UseFilterMode.none
      ? 'off'
      : settings!.use_url_filters === UseFilterMode.guildOnly ? 'on (local only)' : 'on (with global list)';

    const fileFilter = (settings?.use_file_filters ?? UseFilterMode.none) === UseFilterMode.none
      ? 'off'
      : settings!.use_url_filters === UseFilterMode.guildOnly ? 'on (local only)' : 'on (with global list)';

    return send(interaction, {
      content: stripIndents`
        **Here are your current filter settings:**
        • url filter: ${urlFilter}
        • file filter: ${fileFilter}
        • invite filter: ${settings?.use_invite_filters ? 'on' : 'off'}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['config']) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'show': {
        const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
        return this.sendCurrentSettings(interaction, settings);
      }

      case 'edit': {
        let settings: Partial<GuildSettings> = { guild_id: interaction.guild_id };

        if (args.edit.urls != null) {
          settings.use_url_filters = args.edit.urls;
        }

        if (args.edit.files != null) {
          settings.use_file_filters = args.edit.files;
        }

        if (args.edit.invites != null) {
          settings.use_invite_filters = args.edit.invites;
        }

        if (Object.values(settings).length === 1) {
          const [currentSettings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
          return this.sendCurrentSettings(interaction, currentSettings);
        }

        [settings] = await this.sql`
          INSERT INTO guild_settings ${this.sql(settings)}
          ON CONFLICT (guild_id)
          DO
            UPDATE SET ${this.sql(settings)}
            RETURNING *
        `;

        return this.sendCurrentSettings(interaction, settings);
      }

      case 'ignore': {
        const { channel, ...filters } = args.ignore;

        if (channel.type !== ChannelType.GuildText) {
          throw new ControlFlowError('Please provide a text channel');
        }

        return this.sql.begin(async sql => {
          const [existing] = await sql<[FilterIgnore?]>`SELECT * FROM filter_ignores WHERE channel_id = ${channel.id}`;
          const bitfield = new FilterIgnores(BigInt(existing?.value ?? '0'));

          for (const [filter, on] of Object.entries(filters) as [keyof typeof filters, boolean][]) {
            if (on) {
              bitfield.add(filter);
            } else {
              bitfield.remove(filter);
            }
          }

          await sql`
            INSERT INTO filter_ignores (channel_id, guild_id, value)
            VALUES (${channel.id}, ${interaction.guild_id}, ${bitfield.toJSON()})
            ON CONFLICT (channel_id)
            DO UPDATE SET value = ${bitfield.toJSON()}
          `;

          const enabled = bitfield.toArray();

          return send(interaction, {
            content: enabled.length
              ? `The following filters are now being ignored in the given channel: ${enabled.join(', ')}`
              : 'No filters are being ignored in the given channel anymore.'
          });
        });
      }

      case 'ignorelist': {
        const channels = new Map(
          await this.rest.get<RESTGetAPIGuildChannelsResult>(Routes.guildChannels(interaction.guild_id))
            .then(
              channels => channels.map(
                channel => [channel.id, channel]
              )
            )
        );

        const entries = await this.sql<FilterIgnore[]>`SELECT * FROM filter_ignores WHERE guild_id = ${interaction.guild_id} AND value != 0`;
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
