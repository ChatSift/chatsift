import { ConfigAutoCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
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
      if (antispam.amount < 2) {
        throw new ControlFlowError(
          'If you set this value to lower than 2, a punishment would trigger immediately, please use a value equal to or greater than 2.'
        );
      }

      if (antispam.amount > 20) {
        throw new ControlFlowError(
          'Tracking more than 20 messages seems redundant and causes heavy memory usage at scale, please use a lower value.' +
          '\n\nIf you have a use case for this, we\'d love to hear it in the support server.'
        );
      }

      settings.antispam_amount = antispam.amount;
    }

    if (antispam?.time) {
      if (antispam.time < 2) {
        throw new ControlFlowError(
          'With a time lower than 2, a punishment would be nearly impossible to trigger, please use a value equal to or greater than 2.'
        );
      }

      if (antispam.time > 20) {
        throw new ControlFlowError(
          'Tracking messages for more than 20 seconds seems unreasonable and causes heavy memory usage at scale, please use a lower value.' +
          '\n\nIf you have a use case for this, we\'d love to hear it in the support server.'
        );
      }

      settings.antispam_time = antispam.time;
    }

    if (mention?.amount) {
      if (mention.amount < 3) {
        throw new ControlFlowError(
          'With a value this low for mention amounts a punishment will be triggered way too easily on accident.'
        );
      }

      settings.mention_amount = mention.amount;
    }

    if (mention?.limit) {
      if (mention.limit < 3) {
        throw new ControlFlowError(
          'With a value this low for mention amounts a punishment will be triggered way too easily on accident.'
        );
      }

      settings.mention_limit = mention.limit;
    }

    if (mention?.time) {
      if (mention.time < 2) {
        throw new ControlFlowError(
          'With a time lower than 2, a punishment would be nearly impossible to trigger, please use a value equal to or greater than 2.'
        );
      }

      if (mention.time > 20) {
        throw new ControlFlowError(
          'Tracking messages for more than 20 seconds seems unreasonable and causes heavy memory usage at scale, please use a lower value.' +
          '\n\nIf you have a use case for this, we\'d love to hear it in the support server.'
        );
      }

      settings.mention_time = mention.time;
    }

    settings = Object.values(settings).length
      ? await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(`/guilds/${interaction.guild_id}/settings`, settings)
      : await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

    return this._sendCurrentSettings(interaction, settings);
  }
}
