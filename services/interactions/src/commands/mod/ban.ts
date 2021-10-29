import { BanCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, dmUser, getGuildName, send } from '#util';
import {
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  Case,
  CaseAction,
  Log,
  LogTypes,
  ms
} from '@automoderator/core';
import { PermissionsChecker, UserPerms } from '@automoderator/discord-permissions';
import { HTTPError, Rest } from '@automoderator/http-client';
import { kLogger, kSql } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>,
    public readonly checker: PermissionsChecker,
    @inject(kSql) public readonly sql: Sql<{}>,
    @inject(kLogger) public readonly logger: Logger
  ) {}

  public parse(args: ArgumentsOf<typeof BanCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      days: Math.min(Math.max(args.days ?? 1, 1), 7),
      refId: args.reference,
      duration: args.duration
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof BanCommand>) {
    await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
    const { member, reason, days, refId, duration: durationString } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    if (member.user.id === interaction.member.user.id) {
      throw new ControlFlowError('You cannot ban yourself');
    }

    if ('permissions' in member && await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod)) {
      throw new ControlFlowError('You cannot action a member of the staff team');
    }

    let expiresAt: Date | undefined;
    if (durationString) {
      const durationMinutes = Number(durationString);

      if (isNaN(durationMinutes)) {
        const duration = ms(durationString);
        if (!duration) {
          throw new ControlFlowError('Failed to parse the provided duration');
        }

        expiresAt = new Date(Date.now() + duration);
      } else {
        expiresAt = new Date(Date.now() + (durationMinutes * 6e4));
      }
    }

    const [existingBanCase] = await this.sql<[Case?]>`
      SELECT * FROM cases
      WHERE target_id = ${member.user.id}
        AND action_type = ${CaseAction.ban}
        AND guild_id = ${interaction.guild_id}
        AND processed = false
    `;

    if (existingBanCase) {
      throw new ControlFlowError(
        'This user has already been temp banned. If you wish to update the duration please use the `/case duration` command'
      );
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const guildName = await getGuildName(interaction.guild_id);
    await dmUser(
      member.user.id,
      interaction.guild_id,
      `Hello! You have been banned from ${guildName}.${reason ? `\n\nReason: ${reason}` : ''}`
    );

    try {
      const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/guilds/${interaction.guild_id}/cases`, [
        {
          action: CaseAction.ban,
          mod_id: interaction.member.user.id,
          mod_tag: modTag,
          target_id: member.user.id,
          target_tag: targetTag,
          reason,
          reference_id: refId,
          expires_at: expiresAt,
          created_at: new Date(),
          delete_message_days: days,
          execute: true
        }
      ]);

      await send(interaction, { content: `Successfully banned ${targetTag}` });
      this.guildLogs.publish({
        type: LogTypes.modAction,
        data: cs!
      });
    } catch (error) {
      if (error instanceof HTTPError && error.statusCode === 400) {
        return send(interaction, { content: error.message });
      }

      throw error;
    }
  }
}
