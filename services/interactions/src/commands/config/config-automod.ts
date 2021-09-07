import { ConfigAutoCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import {
  ApiGetGuildsSettingsResult,
  ApiPatchGuildSettingsBody,
  ApiPatchGuildSettingsResult,
  AutomodPunishment,
  AutomodPunishmentAction,
  GuildSettings
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { kLogger, kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import type { APIGuildInteraction } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kLogger) public readonly logger: Logger,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private _sendCurrentSettings(interaction: APIGuildInteraction, settings: Partial<GuildSettings>) {
    return send(interaction, {
      content: stripIndents`
        **Here are your current settings:**
        • punishment cooldown: ${settings.automod_cooldown ?? 'not set'}

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
    const { show, antispam, mention, punishments } = args;

    if (show) {
      const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);
      return this._sendCurrentSettings(interaction, settings);
    }

    let settings: Partial<GuildSettings> = {};

    if (punishments) {
      const { add, delete: del, list, 'set-cooldown': setCooldown } = punishments;

      if (setCooldown) {
        if (setCooldown.cooldown < 3) {
          throw new ControlFlowError('Please provide a value equal or greater than 3');
        }

        if (setCooldown.cooldown > 180) {
          throw new ControlFlowError('Please provide a value equal or lower than 180');
        }

        settings.automod_cooldown = setCooldown.cooldown;
      } else if (add) {
        const data: AutomodPunishment = {
          guild_id: interaction.guild_id,
          triggers: add.count,
          action_type: add.punishment,
          duration: null
        };

        if (add.duration) {
          if (data.action_type === AutomodPunishmentAction.kick || data.action_type === AutomodPunishmentAction.warn) {
            throw new ControlFlowError('Cannot set a duration for kicks or warns');
          }

          data.duration = add.duration;
        }

        await this.sql`
          INSERT INTO automod_punishments ${this.sql(data)}
          ON CONFLICT (guild_id, triggers)
          DO UPDATE SET duration = ${data.duration}
        `;

        return send(interaction, {
          content: `On trigger number ${data.triggers} a ${AutomodPunishmentAction[data.action_type]} will be issued.`
        });
      } else if (del) {
        const [punishment] = await this.sql<[AutomodPunishment?]>`
          DELETE FROM automod_punishments
          WHERE guild_id = ${interaction.guild_id}
            AND triggers = ${del.count}
          RETURNING *
        `;

        if (!punishment) {
          throw new ControlFlowError('Could not find a punishment to delete');
        }

        return send(interaction, { content: `Successfully deleted the punishment at ${del.count} triggers` });
      } else if (list) {
        const punishments = await this
          .sql<AutomodPunishment[]>`SELECT * FROM automod_punishments WHERE guild_id = ${interaction.guild_id}`
          .then(
            rows => rows.map(
              p => `• At ${p.triggers} triggers, the user will be punished with a ${AutomodPunishmentAction[p.action_type]} ${
                p.duration ? `, which will last ${p.duration} minutes` : ''
              }`
            )
          );

        return send(interaction, {
          content: punishments.length
            ? `List of punishments:\n${punishments.join('\n')}`
            : 'There are currently no punishments'
        });
      }
    }

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
