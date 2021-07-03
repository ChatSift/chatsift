import { injectable, inject } from 'tsyringe';
import { Command, UserPerms } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '../../util';
import { StrikeCommand } from '../../interactions/mod/strike';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, Routes } from 'discord-api-types/v8';
import { PubSubServer } from '@cordis/brokers';
import { kSql } from '@automoderator/injection';
import {
  ApiPatchGuildsCasesBody,
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  Case,
  CaseAction,
  Log,
  LogTypes,
  Strike,
  StrikePunishment,
  StrikePunishmentAction
} from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubServer<Log>,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public parse(args: ArgumentsOf<typeof StrikeCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof StrikeCommand>) {
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.strike,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId
      }
    ]);

    const strikes = await this
      .sql<Strike[]>`SELECT * FROM strikes WHERE guild_id = ${interaction.guild_id} AND user_id = ${member.user.id}`
      .then(rows => rows.length + 1);

    if (strikes > 0) {
      const [punishment] = await this.sql<[StrikePunishment?]>`
        SELECT * FROM strike_punishments
        WHERE guild_id = ${interaction.guild_id}
          AND strikes = ${strikes}
      `;

      if (punishment) {
        interface ResolvedCases {
          [CaseAction.mute]?: Case;
          [CaseAction.ban]?: Case;
        }

        const cases = await this.sql<[Case?, Case?]>`
          SELECT * FROM cases
          WHERE target_id = ${member.user.id}
            AND processed = false
            AND guild_id = ${interaction.guild_id}
        `
          .then(
            rows => rows.reduce<ResolvedCases>(
              (acc, cs) => {
                if (cs) {
                  acc[cs.action_type as CaseAction.mute | CaseAction.ban] = cs;
                }

                return acc;
              }, {}
            )
          );

        switch (punishment.action_type) {
          case StrikePunishmentAction.mute: {
            const cs = cases[CaseAction.mute];

            const expiresAt = punishment.duration
              ? new Date(
                (punishment.duration * 6e4) + (cs?.expires_at?.getTime() ?? 0)
              )
              : null;

            if (cs) {
              await this.rest.patch<unknown, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  case_id: cs.id,
                  expires_at: expiresAt
                }
              ]);
            } else {
              await this.rest.post<unknown, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  action: CaseAction.mute,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag,
                  target_id: member.user.id,
                  target_tag: targetTag,
                  reason,
                  reference_id: cs!.case_id,
                  expires_at: expiresAt
                }
              ]);
            }

            break;
          }

          case StrikePunishmentAction.ban: {
            const cs = cases[CaseAction.ban];

            const expiresAt = punishment.duration
              ? new Date(
                (punishment.duration * 6e4) + (cs?.expires_at?.getTime() ?? 0)
              )
              : null;

            if (cs) {
              await this.rest.patch<unknown, ApiPatchGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  case_id: cs.id,
                  expires_at: expiresAt
                }
              ]);
            } else {
              await this.rest.post<unknown, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  action: CaseAction.ban,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag,
                  target_id: member.user.id,
                  target_tag: targetTag,
                  reason,
                  reference_id: cs!.case_id,
                  expires_at: expiresAt
                }
              ]);
            }

            break;
          }

          case StrikePunishmentAction.kick: {
            await this.discordRest.delete(Routes.guildMember(interaction.guild_id, member.user.id), { reason: `Kick | By ${modTag}` });
            break;
          }
        }
      }
    }

    await send(interaction, { content: `Successfully striked ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
