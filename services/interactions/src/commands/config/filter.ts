import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, send, UserPerms } from '#util';
import { FilterCommand } from '#interactions';
import { Rest } from '@cordis/rest';
import { APIGuildInteraction } from 'discord-api-types/v8';
import { kSql } from '@automoderator/injection';
import { stripIndents } from 'common-tags';
import { GuildSettings, UseFilterMode } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private _sendCurrentSettings(message: APIGuildInteraction, settings?: Partial<GuildSettings>) {
    const urlFilter = (settings?.use_url_filters ?? UseFilterMode.none) === UseFilterMode.none
      ? 'off'
      : settings!.use_url_filters === UseFilterMode.guildOnly ? 'on (local only)' : 'on (with global list)';

    return send(message, {
      content: stripIndents`
        **Here are your current filter settings:**
        • url filter: ${urlFilter}
        • file filter: ${settings?.use_url_filters === UseFilterMode.all ? 'on' : 'off'}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  public parse(args: ArgumentsOf<typeof FilterCommand>) {
    return {
      urls: args.urls,
      files: args.files
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof FilterCommand>) {
    const { urls, files } = this.parse(args);

    let settings: Partial<GuildSettings> = { guild_id: interaction.guild_id };

    if (urls) settings.use_url_filters = urls;
    if (files) settings.use_file_filters = files;

    if (Object.values(settings).length === 1) {
      const [currentSettings] = await this.sql<[GuildSettings?]>`SELECT * FROM settings WHERE guild_id = ${interaction.guild_id}`;
      return this._sendCurrentSettings(interaction, currentSettings);
    }

    [settings] = await this.sql`
      INSERT INTO guild_settings ${this.sql(settings)}
      ON CONFLICT (guild_id)
      DO
        UPDATE SET ${this.sql(settings)}
        RETURNING *
    `;

    return this._sendCurrentSettings(interaction, settings);
  }
}
