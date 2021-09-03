import { ConfigAutoCommand } from '#interactions';
import { ArgumentsOf, send } from '#util';
import {
  ApiGetGuildsSettingsResult,
  ApiPatchGuildSettingsBody,
  ApiPatchGuildSettingsResult,
  GuildSettings
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { Config, kConfig, kLogger, kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { Handler } from '../../handler';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly handler: Handler,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kConfig) public readonly config: Config,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private _sendCurrentSettings(interaction: APIGuildInteraction, settings: Partial<GuildSettings>) {
    return send(interaction, {
      content: stripIndents`
        **Here are your current settings:**
        • text amount: ${settings.antispam_amount ?? 'not set'}
        • text time: ${settings.antispam_time ?? 'not set'}

        • mention limit: ${settings.mention_limit ?? 'not set'}
        • mention amount: ${settings.mention_amount ?? 'not set'}
        • mention time: ${settings.mention_time ?? 'not set'}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  public async exec(interaction: APIGuildInteraction, args: Partial<ArgumentsOf<typeof ConfigAutoCommand>>) {
    const { show, antispam, mention } = args;

    if (show) {
      const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);
      return this._sendCurrentSettings(interaction, settings);
    }

    let settings: Partial<GuildSettings> = {};

    if (antispam?.amount) {
      settings.antispam_amount = antispam.amount;
    }

    if (antispam?.time) {
      settings.antispam_time = antispam.time;
    }

    if (mention?.amount) {
      settings.mention_amount = mention.amount;
    }

    if (mention?.limit) {
      settings.mention_limit = mention.limit;
    }

    if (mention?.time) {
      settings.mention_time = mention.time;
    }

    settings = Object.values(settings).length
      ? await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(`/guilds/${interaction.guild_id}/settings`, settings)
      : await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

    return this._sendCurrentSettings(interaction, settings);
  }
}
