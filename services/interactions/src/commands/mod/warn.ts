import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, dmUser, getGuildName, send } from '#util';
import { PermissionsChecker, UserPerms } from '@automoderator/discord-permissions';
import { WarnCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { APIGuildInteraction, Routes } from 'discord-api-types/v9';
import { ApiPatchGuildsCasesBody, ApiPostGuildsCasesBody, ApiPostGuildsCasesResult, Case, CaseAction, HttpCase, Log, LogTypes, WarnCase, WarnPunishment, WarnPunishmentAction } from '@automoderator/core';
import { PubSubPublisher } from '@cordis/brokers';
import { kSql } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>,
    public readonly checker: PermissionsChecker,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public parse(args: ArgumentsOf<typeof WarnCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof WarnCommand>) {
    const { member, reason, refId } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    if (member.user.id === interaction.member.user.id) {
      throw new ControlFlowError('You cannot ban yourself');
    }

    if (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod)) {
      throw new ControlFlowError('You cannot action a member of the staff team');
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.warn,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        created_at: new Date()
      }
    ]);

    const guildName = await getGuildName(interaction.guild_id);
    await dmUser(member.user.id, `Hello! You have been warned in ${guildName}.\n\nReason: ${reason ?? 'No reason provided.'}`);

    const warns = await this
      .sql`
        SELECT * FROM cases
        WHERE guild_id = ${interaction.guild_id}
          AND target_id = ${member.user.id}
          AND action_type = ${CaseAction.warn}
          AND pardoned_by IS NULL
      `
      .then(rows => rows.length);

    let triggeredCs: HttpCase | undefined;
    let updatedCs: HttpCase | undefined;
    let duration: number | undefined;
    let extendedBy: number | undefined;

    const [punishment] = await this.sql<[WarnPunishment?]>`
        SELECT * FROM warn_punishments
        WHERE guild_id = ${interaction.guild_id}
          AND warns = ${warns}
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
        case WarnPunishmentAction.mute: {
          const muteCase = cases[CaseAction.mute];

          let expiresAt: Date | null = null;
          if (punishment.duration) {
            extendedBy = muteCase?.expires_at?.getTime();
            duration = (punishment.duration * 6e4) + (extendedBy ?? 0);
            expiresAt = new Date(duration);
          }

          if (muteCase) {
            [updatedCs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
              `/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  case_id: muteCase.id,
                  expires_at: expiresAt,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag
                }
              ]
            );
          } else {
            [triggeredCs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
              `/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  action: CaseAction.mute,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag,
                  target_id: member.user.id,
                  target_tag: targetTag,
                  reason,
                  reference_id: cs!.case_id,
                  expires_at: expiresAt,
                  created_at: new Date()
                }
              ]
            );
          }

          break;
        }

        case WarnPunishmentAction.ban: {
          const banCase = cases[CaseAction.ban];

          let expiresAt: Date | null = null;
          if (punishment.duration) {
            extendedBy = banCase?.expires_at?.getTime();
            duration = (punishment.duration * 6e4) + (extendedBy ?? 0);
            expiresAt = new Date(duration);
          }

          if (banCase) {
            [updatedCs] = await this.rest.patch<ApiPostGuildsCasesResult, ApiPatchGuildsCasesBody>(
              `/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  case_id: banCase.id,
                  expires_at: expiresAt,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag
                }
              ]
            );
          } else {
            [triggeredCs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(
              `/api/v1/guilds/${interaction.guild_id}/cases`, [
                {
                  action: CaseAction.ban,
                  mod_id: interaction.member.user.id,
                  mod_tag: modTag,
                  target_id: member.user.id,
                  target_tag: targetTag,
                  reason,
                  reference_id: cs!.case_id,
                  expires_at: expiresAt,
                  created_at: new Date()
                }
              ]
            );
          }

          break;
        }

        case WarnPunishmentAction.kick: {
          await this.discordRest.delete(Routes.guildMember(interaction.guild_id, member.user.id), { reason: `Kick | By ${modTag}` });
          break;
        }
      }
    }

    const data: WarnCase = { ...(cs as Omit<HttpCase, 'action_type'> & { action_type: CaseAction.warn }) };

    if (triggeredCs || updatedCs) {
      const triggered = ({
        [CaseAction.kick]: WarnPunishmentAction.kick,
        [CaseAction.mute]: WarnPunishmentAction.mute,
        [CaseAction.ban]: WarnPunishmentAction.ban
      } as const)[(triggeredCs ?? updatedCs)!.action_type as CaseAction.kick | CaseAction.mute | CaseAction.ban];

      data.extra = triggered === WarnPunishmentAction.kick
        ? { triggered }
        : { triggered, duration, extendedBy };
    }

    await send(interaction, { content: `Successfully warned ${targetTag}` });
    this.guildLogs.publish({ type: LogTypes.modAction, data });

    if (updatedCs) {
      this.guildLogs.publish({ type: LogTypes.modAction, data: updatedCs });
    }
  }
}
