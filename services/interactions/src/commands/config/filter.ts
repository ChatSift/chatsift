import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, send, UserPerms } from '#util';
import { FilterCommand } from '#interactions';
import { APIGuildInteraction } from 'discord-api-types/v9';
import { kSql } from '@automoderator/injection';
import { stripIndents } from 'common-tags';
import { HTTPError, Rest } from '@automoderator/http-client';
import {
  ApiDeleteGuildsFiltersFilesBody,
  ApiDeleteGuildsFiltersUrlsBody,
  ApiPutGuildsFiltersFilesBody,
  ApiPutGuildsFiltersUrlsBody,
  GuildSettings,
  UseFilterMode
} from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private sendCurrentSettings(message: APIGuildInteraction, settings?: Partial<GuildSettings>) {
    const urlFilter = (settings?.use_url_filters ?? UseFilterMode.none) === UseFilterMode.none
      ? 'off'
      : settings!.use_url_filters === UseFilterMode.guildOnly ? 'on (local only)' : 'on (with global list)';

    const fileFilter = (settings?.use_file_filters ?? UseFilterMode.none) === UseFilterMode.none
      ? 'off'
      : settings!.use_url_filters === UseFilterMode.guildOnly ? 'on (local only)' : 'on (with global list)';

    return send(message, {
      content: stripIndents`
        **Here are your current filter settings:**
        • url filter: ${urlFilter}
        • file filter: ${fileFilter}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  private updateSettings(settings: Partial<GuildSettings>, args: ArgumentsOf<typeof FilterCommand>['config']['edit']) {
    switch (args.filter) {
      case 'files': {
        settings.use_file_filters = args.mode;
        break;
      }

      case 'urls': {
        settings.use_url_filters = args.mode;
        break;
      }
    }

    return settings;
  }

  private async config(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>['config']) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'show': {
        const [settings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
        return this.sendCurrentSettings(interaction, settings);
      }

      case 'edit': {
        let settings = this.updateSettings({ guild_id: interaction.guild_id }, args.edit);

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
    }
  }

  private handleHttpError(interaction: APIGuildInteraction, error: HTTPError) {
    switch (error.statusCode) {
      case 404: {
        return send(interaction, { content: 'The given entry could not be found', flags: 64 });
      }

      default: {
        throw error;
      }
    }
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>) {
    switch (Object.keys(args)[0] as keyof typeof args) {
      case 'config': {
        return this.config(interaction, args.config);
      }

      case 'add': {
        if (args.add.filter === 'files') {
          await this.rest.put<unknown, ApiPutGuildsFiltersFilesBody>(
            `/api/v1/guilds/${interaction.guild_id}/filters/files`,
            [args.add.entry]
          );

          return send(interaction, { content: 'Successfully added the given file hash to the filter list' });
        }

        await this.rest.put<unknown, ApiPutGuildsFiltersUrlsBody>(
          `/api/v1/guilds/${interaction.guild_id}/filters/files`,
          [args.add.entry]
        );

        return send(interaction, { content: 'Successfully added the given url to the filter list' });
      }

      case 'remove': {
        try {
          if (args.remove.filter === 'files') {
            await this.rest.delete<unknown, ApiDeleteGuildsFiltersFilesBody>(
              `/api/v1/guilds/${interaction.guild_id}/filters/files`,
              [args.remove.entry]
            );

            return send(interaction, { content: 'Successfully removed the given file hash to the filter list' });
          }

          await this.rest.delete<unknown, ApiDeleteGuildsFiltersUrlsBody>(
            `/api/v1/guilds/${interaction.guild_id}/filters/files`,
            [args.remove.entry]
          );

          return send(interaction, { content: 'Successfully removed the given url to the filter list' });
        } catch (error) {
          if (!(error instanceof HTTPError)) {
            throw error;
          }

          return this.handleHttpError(interaction, error);
        }
      }
    }
  }
}
